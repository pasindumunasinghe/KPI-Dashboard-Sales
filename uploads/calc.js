// Sales & Expenses Dashboard — data aggregation + KPI calculation logic.
// Plain script (no ES modules) — exposes window.DashboardCalc.
(function () {
  var MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

  function excelSerialToDate(serial) {
    if (serial === undefined || serial === null || serial === '') return null;
    if (typeof serial === 'number' || /^\d+(\.\d+)?$/.test(String(serial).trim())) {
      var n = typeof serial === 'number' ? serial : parseFloat(serial);
      if (!isFinite(n)) return null;
      // Excel epoch 1899-12-30
      var utcDays = Math.floor(n - 25569);
      var utcMs = utcDays * 86400 * 1000;
      return new Date(utcMs);
    }
    var s = String(serial).trim();
    // dd.mm.yyyy or dd/mm/yyyy
    var m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));
    // yyyy-mm-dd
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));
    // dd-MMM-yy or dd-MMM-yyyy (e.g. 25-Apr-26)
    m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (m) {
      var monthNames3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      var mi = monthNames3.indexOf(m[2].toLowerCase());
      if (mi !== -1) {
        var yr = parseInt(m[3]);
        if (yr < 100) yr += 2000;
        return new Date(Date.UTC(yr, mi, parseInt(m[1])));
      }
    }
    var parsed = Date.parse(s);
    return isNaN(parsed) ? null : new Date(parsed);
  }

  function monthNameFromSerial(serial) {
    var d = excelSerialToDate(serial);
    if (!d) return null;
    var idx = d.getUTCMonth(); // 0=Jan
    var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[idx];
  }

  // Derive Main Channel from raw "Distribution Channel" code + "Sales Employee",
  // per the client's channel-mapping formula.
  var MAIN_CHANNEL_MAP = {
    '10': 'Distribution', '11': 'Distribution', '12': 'Distribution', '14': 'Distribution',
    '13': 'Digital', '15': 'Digital', '36': 'Digital',
    '20': 'Export', '21': 'Export', '71': 'Export',
    '30': 'Project', '31': 'Project', '32': 'Project', '33': 'Project', '34': 'Project', '35': 'Project',
    '40': 'Retail', '41': 'Retail', '42': 'Retail', '43': 'Retail',
    '51': 'After Sales',
    '52': 'Manufacturing',
    '54': 'Other', '80': 'Other'
  };
  function deriveMainChannel(distributionChannel, salesEmployee) {
    var code = String(distributionChannel || '').trim();
    if (code === '91') {
      return String(salesEmployee || '').trim() === '10265' ? 'Distribution' : 'Other';
    }
    return MAIN_CHANNEL_MAP[code] || 'Other';
  }

  // Derive Sub Channel from raw "Distribution Channel1" text + "Bill-to Party" + "Sales Employee".
  function deriveSubChannel(distributionChannel1, billToParty, salesEmployee) {
    var v = String(distributionChannel1 || '').trim();
    var bp = String(billToParty || '').trim();
    var se = String(salesEmployee || '').trim();
    if (v === 'Project') return 'Not Assigned';
    if (v === 'Wireman, Ruhunu & PV') return 'Wireman, Ruhunu & PVC';
    if (v === 'Local') return 'Not Assigned';
    if (v === 'Intercompany - Forei') return 'Intercompany - Foreign';
    if (v === 'International Distri') return 'International Distributors';
    if (v === 'Special Admin' && bp === '25CS05') return 'Factory Outlet - Eka';
    if (v === 'Special Admin' && se === '10265') return 'Modern Trade';
    if (v === 'Special Admin') return 'Special Admin';
    return v;
  }

  // Some Sales Report exports come straight from a BW/BI query: several metadata
  // rows on top ("Query Name", "Filter", ...) followed by a header row with
  // duplicated column names (code column immediately followed by its
  // description column, e.g. "Distribution Channel","Distribution Channel").
  // Detect that shape and rewrite it into the canonical single-header-row shape
  // the rest of the pipeline expects.
  function normalizeSalesRows(rawRows) {
    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(rawRows.length, 60); i++) {
      var r = rawRows[i];
      if (!r) continue;
      if (String(r[0] || '').trim() === 'Sales Organization' && r.indexOf('Billing Date') !== -1) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx === -1) return rawRows; // already canonical single-header-row format

    var headerRow = rawRows[headerRowIdx];
    var seen = {};
    var canonical = [];
    var RENAME_FIRST_DUP = { 'Distribution Channel': 'Distribution Channel1', 'Bill-to Party': 'Bill-to Party1', 'Sales Employee': 'Sales Employee1', 'Plant': 'Plant1', 'Material': 'Material1' };
    var RENAME_DIRECT = {};
    for (var c = 0; c < headerRow.length; c++) {
      var name = String(headerRow[c] || '').trim();
      if (RENAME_DIRECT[name]) {
        canonical[c] = RENAME_DIRECT[name];
      } else if (RENAME_FIRST_DUP.hasOwnProperty(name)) {
        canonical[c] = seen[name] ? RENAME_FIRST_DUP[name] : name;
        seen[name] = true;
      } else {
        canonical[c] = name;
      }
    }
    var dataRows = rawRows.slice(headerRowIdx + 1);
    var salesOrgIdx = canonical.indexOf('Sales Organization');
    var billingTypeIdx = canonical.indexOf('Billing Type');
    var qtyIdx = canonical.indexOf('Sales Volume Qty');
    var creditQtyIdx = canonical.indexOf('Credit Memos Qty');
    var netSalesVolIdx = canonical.indexOf('Net Sales Volume');
    var netProfitIdx = canonical.indexOf('Net Profit Margin');

    // Strip a trailing SAP magnitude-unit letter (K/M/B/R/P/A/N) off a numeric-ish
    // string, drop thousands separators, and coerce to a plain number string.
    function parseSapNumber(raw) {
      var s = String(raw == null ? '' : raw).trim();
      if (!s) return '0';
      var units = ['M', 'B', 'K', 'R', 'P', 'A', 'N'];
      for (var u = 0; u < units.length; u++) {
        var idx = s.indexOf(units[u]);
        if (idx > 0) { s = s.slice(0, idx); break; }
      }
      s = s.replace(/,/g, '').replace(/^LKR\s*/i, '');
      return s;
    }

    var RETURN_BILLING_TYPES = { ZCMR: true, ZQBR: true };
    var normalizedRows = dataRows.map(function (r) {
      if (!r) return r;
      var row = r.slice();
      if (salesOrgIdx !== -1) {
        var org = String(row[salesOrgIdx] || '').trim();
        if (org === 'Orel Ceylon (Pvt) Lt') row[salesOrgIdx] = 'Orel Ceylon (Pvt) Ltd';
      }
      var isReturn = billingTypeIdx !== -1 && RETURN_BILLING_TYPES[String(row[billingTypeIdx] || '').trim()];
      if (qtyIdx !== -1) {
        var qtySrc = isReturn && creditQtyIdx !== -1 ? row[creditQtyIdx] : row[qtyIdx];
        var qtyNum = parseFloat(parseSapNumber(qtySrc)) || 0;
        row[qtyIdx] = isReturn ? -Math.abs(qtyNum) : qtyNum;
      }
      if (netSalesVolIdx !== -1) {
        row[netSalesVolIdx] = parseFloat(parseSapNumber(row[netSalesVolIdx])) || 0;
      }
      if (netProfitIdx !== -1) {
        row[netProfitIdx] = parseFloat(parseSapNumber(row[netProfitIdx])) || 0;
      }
      return row;
    });

    if (qtyIdx !== -1) canonical[qtyIdx] = 'Qty';
    if (netSalesVolIdx !== -1) canonical[netSalesVolIdx] = 'Sales Value';

    var allowedOrgs = { 'orel corporation': true, 'orel ceylon (pvt) ltd': true };
    if (salesOrgIdx !== -1) {
      normalizedRows = normalizedRows.filter(function (r) {
        return r && allowedOrgs[String(r[salesOrgIdx] || '').trim().toLowerCase()];
      });
    }
    return [canonical].concat(normalizedRows);
  }

  function normalizeGLCategory(raw) {
    if (!raw) return null;
    var s = String(raw).split(' - ')[0].trim();
    return s === 'Cost Of Sales' ? 'Cost Of Sales' : s;
  }

  // Build a column-name -> index map from a header row (case-insensitive, trimmed).
  function headerMap(headerRow) {
    var map = {};
    headerRow.forEach(function (h, i) {
      if (h === undefined || h === null || h === '') return;
      map[String(h).trim().toLowerCase()] = i;
    });
    return map;
  }
  function col(map, row, name) {
    var i = map[name.toLowerCase()];
    if (i === undefined) return undefined;
    return row[i];
  }
  function num(v) {
    if (v === undefined || v === null || v === '') return 0;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isIntegerCode(v) {
    return /^\d+$/.test(String(v).trim());
  }

  function deepGet(obj, path, dflt) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return dflt;
      cur = cur[path[i]];
    }
    return cur === undefined ? dflt : cur;
  }
  function deepAdd(obj, path, amount) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) {
      var k = path[i];
      if (!cur[k]) cur[k] = {};
      cur = cur[k];
    }
    var last = path[path.length - 1];
    cur[last] = (cur[last] || 0) + amount;
  }

  function makeItemCostKey(material, plant) {
    return String(material || '').trim().toUpperCase() + '|' + String(plant || '').trim().toUpperCase();
  }

  function buildMM60Map(mm60Rows) {
    var map = {};
    if (!mm60Rows || mm60Rows.length < 2) return map;
    var hm = headerMap(mm60Rows[0]);
    for (var i = 1; i < mm60Rows.length; i++) {
      var r = mm60Rows[i];
      if (!r || !r.length) continue;
      var material = col(hm, r, 'Material');
      var plant = col(hm, r, 'Plant');
      var price = num(col(hm, r, 'Price'));
      if (material === undefined || plant === undefined) continue;
      map[makeItemCostKey(material, plant)] = price;
    }
    return map;
  }

  // Precomputed mm60 price maps (loaded from JSON) may have been built with
  // raw, non-normalized keys — re-key them the same way as buildMM60Map so
  // Material+Plant lookups always match regardless of case/whitespace.
  function normalizeItemCostMap(rawMap) {
    var map = {};
    if (!rawMap) return map;
    Object.keys(rawMap).forEach(function (key) {
      var parts = key.split('|');
      var material = parts[0];
      var plant = parts.slice(1).join('|');
      map[makeItemCostKey(material, plant)] = rawMap[key];
    });
    return map;
  }

  function buildGLMap(glRows) {
    var map = {};
    if (!glRows || glRows.length < 2) return map;
    var hm = headerMap(glRows[0]);
    for (var i = 1; i < glRows.length; i++) {
      var r = glRows[i];
      if (!r || !r.length) continue;
      var category = col(hm, r, 'GL Category');
      var code = col(hm, r, 'GL Code');
      if (!category || code === undefined || code === '') continue;
      map[String(code).trim()] = normalizeGLCategory(category);
    }
    return map;
  }

  // ---- Sales + COGS aggregation ----
  // sales[month][mainChannel][subChannel] = { actual: number, cogs: number }
  function aggregateSales(salesRowsRaw, mm60Map) {
    var agg = {};
    var mainChannelsSeen = {};
    var salesRows = normalizeSalesRows(salesRowsRaw);
    if (!salesRows || salesRows.length < 2) return { agg: agg, mainChannels: [] };
    var hm = headerMap(salesRows[0]);
    for (var i = 1; i < salesRows.length; i++) {
      var r = salesRows[i];
      if (!r || !r.length) continue;
      var billingDate = col(hm, r, 'Billing Date');
      var month = monthNameFromSerial(billingDate);
      if (!month) continue;
      var distributionChannel = col(hm, r, 'Distribution Channel');
      var distributionChannel1 = col(hm, r, 'Distribution Channel1');
      var billToParty = col(hm, r, 'Bill-to Party');
      var salesEmployee = col(hm, r, 'Sales Employee');
      var main = distributionChannel !== undefined
        ? deriveMainChannel(distributionChannel, salesEmployee)
        : String(col(hm, r, 'Main Channel') || 'Unassigned').trim();
      var sub = distributionChannel1 !== undefined
        ? deriveSubChannel(distributionChannel1, billToParty, salesEmployee)
        : String(col(hm, r, 'Sub Channel') || 'Unassigned').trim();
      var salesValue = num(col(hm, r, 'Sales Value'));
      var qty = num(col(hm, r, 'Qty'));
      var material = String(col(hm, r, 'Material') || '').trim();
      var plant = String(col(hm, r, 'Plant') || '').trim();
      var unitCost = mm60Map[makeItemCostKey(material, plant)] || 0;
      var cogs = qty * unitCost;

      mainChannelsSeen[main] = mainChannelsSeen[main] || {};
      mainChannelsSeen[main][sub] = true;

      deepAdd(agg, [month, main, sub, 'actual'], salesValue);
      deepAdd(agg, [month, main, sub, 'cogs'], cogs);
    }
    var mainChannels = Object.keys(mainChannelsSeen).sort().map(function (m) {
      return { main: m, subs: Object.keys(mainChannelsSeen[m]).sort() };
    });
    return { agg: agg, mainChannels: mainChannels };
  }

  // targets[month][mainChannel][subChannel] = number
  function aggregateTargets(targetRows) {
    var agg = {};
    if (!targetRows || targetRows.length < 2) return agg;
    var hm = headerMap(targetRows[0]);
    for (var i = 1; i < targetRows.length; i++) {
      var r = targetRows[i];
      if (!r || !r.length) continue;
      var main = String(col(hm, r, 'Main Channel') || 'Unassigned').trim();
      var sub = String(col(hm, r, 'Sub Channel') || 'Unassigned').trim();
      MONTHS.forEach(function (month) {
        var v = num(col(hm, r, month));
        deepAdd(agg, [month, main, sub], v);
      });
    }
    return agg;
  }

  // expenses[month][category] = number  (company-wide; not split by channel — source has no channel dimension)
  function aggregateExpenses(expenseRows, glMap, allowedCompanyCodes) {
    var agg = {};
    if (!expenseRows || expenseRows.length < 2) return agg;
    var hm = headerMap(expenseRows[0]);
    var allowedSet = null;
    if (allowedCompanyCodes && allowedCompanyCodes.length) {
      allowedSet = {};
      allowedCompanyCodes.forEach(function (c) { allowedSet[String(c).trim()] = true; });
    }
    for (var i = 1; i < expenseRows.length; i++) {
      var r = expenseRows[i];
      if (!r || !r.length) continue;
      var companyCode = col(hm, r, 'Company Code');
      if (companyCode === undefined || !isIntegerCode(companyCode)) continue;
      if (allowedSet && !allowedSet[String(companyCode).trim()]) continue;
      var postingDate = col(hm, r, 'Posting Date');
      var month = monthNameFromSerial(postingDate);
      if (!month) continue;
      var glCode = String(col(hm, r, 'G/L Account') || '').trim();
      var category = glMap[glCode];
      if (!category) continue;
      var amount = num(col(hm, r, 'Amount in Local Currency'));
      deepAdd(agg, [month, category], amount);
    }
    return agg;
  }

  function buildDataset(files) {
    var mm60Map = files.mm60PriceMap ? normalizeItemCostMap(files.mm60PriceMap) : buildMM60Map(files.mm60Rows);
    var glMap = buildGLMap(files.glRows);
    var salesResult = aggregateSales(files.salesRows, mm60Map);
    var targets = aggregateTargets(files.targetRows);
    var expenses = aggregateExpenses(files.expenseRows, glMap, files.allowedCompanyCodes || ['1100', '1600']);
    return {
      months: MONTHS,
      mainChannels: salesResult.mainChannels,
      sales: salesResult.agg,
      targets: targets,
      expenses: expenses,
      builtAt: new Date().toISOString()
    };
  }

  // ---- KPI computation from a built dataset given filters ----
  function sumSalesCogs(dataset, months, main, sub) {
    var actual = 0, cogs = 0;
    months.forEach(function (month) {
      var monthObj = dataset.sales[month];
      if (!monthObj) return;
      var mains = main === 'ALL' ? Object.keys(monthObj) : [main];
      mains.forEach(function (m) {
        var subsObj = monthObj[m];
        if (!subsObj) return;
        var subs = sub === 'ALL' ? Object.keys(subsObj) : [sub];
        subs.forEach(function (s) {
          var cell = subsObj[s];
          if (!cell) return;
          actual += cell.actual || 0;
          cogs += cell.cogs || 0;
        });
      });
    });
    return { actual: actual, cogs: cogs };
  }

  function sumTarget(dataset, months, main, sub) {
    var total = 0;
    months.forEach(function (month) {
      var monthObj = dataset.targets[month];
      if (!monthObj) return;
      var mains = main === 'ALL' ? Object.keys(monthObj) : [main];
      mains.forEach(function (m) {
        var subsObj = monthObj[m];
        if (!subsObj) return;
        var subs = sub === 'ALL' ? Object.keys(subsObj) : [sub];
        subs.forEach(function (s) {
          total += subsObj[s] || 0;
        });
      });
    });
    return total;
  }

  function sumExpenseCategory(dataset, months, category) {
    var total = 0;
    months.forEach(function (month) {
      var monthObj = dataset.expenses[month];
      if (!monthObj) return;
      total += monthObj[category] || 0;
    });
    return total;
  }

  function computeKPIs(dataset, filters) {
    var months = filters.month === 'ALL' ? dataset.months : [filters.month];
    var main = filters.mainChannel || 'ALL';
    var sub = filters.subChannel || 'ALL';
    var gpTargetPct = filters.gpTargetPct != null ? filters.gpTargetPct : 20;
    var npatTargetPct = filters.npatTargetPct != null ? filters.npatTargetPct : 10;

    var sc = sumSalesCogs(dataset, months, main, sub);
    var primarySalesActual = sc.actual;
    var primarySalesTarget = sumTarget(dataset, months, main, sub);
    var primarySalesAch = primarySalesTarget ? primarySalesActual / primarySalesTarget : 0;

    var cogs = sc.cogs;
    var costOfSalesGL = sumExpenseCategory(dataset, months, 'Cost Of Sales');
    var costOfSalesTotal = cogs + costOfSalesGL;
    var grossProfit = primarySalesActual - costOfSalesTotal;
    var gpActualPct = primarySalesActual ? grossProfit / primarySalesActual : 0;
    var gpAchievement = (primarySalesTarget && gpTargetPct) ? grossProfit / (primarySalesTarget * (gpTargetPct / 100)) : 0;

    var spi = sumExpenseCategory(dataset, months, 'Sales Performance Incentives');
    var gee = sumExpenseCategory(dataset, months, 'General Employee Expenses');
    var totalEmployeeRelated = spi + gee;
    var admin = sumExpenseCategory(dataset, months, 'Administration Expenses');
    var sd = sumExpenseCategory(dataset, months, 'Selling & Distribution Expenses');
    var other = sumExpenseCategory(dataset, months, 'Other Expenses');
    var badDebt = sumExpenseCategory(dataset, months, 'Bad Debtor Provision');
    var totalOperationExpenses = spi + gee + admin + sd + other + badDebt;

    var ebit = grossProfit - totalOperationExpenses;
    var ebitPct = primarySalesActual ? ebit / primarySalesActual : 0;

    var financeCost = sumExpenseCategory(dataset, months, 'Finance Cost');
    var npbt = ebit - financeCost;
    var npbtPct = primarySalesActual ? npbt / primarySalesActual : 0;

    var corporateTax = npbt * 0.30;
    var npat = npbt - corporateTax;
    var npatActualPct = primarySalesActual ? npat / primarySalesActual : 0;
    var npatAchievement = (primarySalesTarget && npatTargetPct) ? npat / (primarySalesTarget * (npatTargetPct / 100)) : 0;

    return {
      primarySales: { actual: primarySalesActual, target: primarySalesTarget, achievementPct: primarySalesAch * 100 },
      cogs: cogs,
      costOfSalesGL: costOfSalesGL,
      costOfSalesTotal: costOfSalesTotal,
      grossProfit: grossProfit,
      grossProfitPct: { actual: gpActualPct * 100, target: gpTargetPct, achievementPct: gpAchievement * 100 },
      expenses: {
        spi: spi, gee: gee, totalEmployeeRelated: totalEmployeeRelated,
        admin: admin, sd: sd, other: other, badDebt: badDebt,
        totalOperationExpenses: totalOperationExpenses
      },
      ebit: ebit,
      ebitPct: ebitPct * 100,
      financeCost: financeCost,
      npbt: npbt,
      npbtPct: npbtPct * 100,
      corporateTax: corporateTax,
      npat: npat,
      npatPct: { actual: npatActualPct * 100, target: npatTargetPct, achievementPct: npatAchievement * 100 }
    };
  }

  window.DashboardCalc = {
    MONTHS: MONTHS,
    headerMap: headerMap,
    col: col,
    num: num,
    deriveMainChannel: deriveMainChannel,
    deriveSubChannel: deriveSubChannel,
    normalizeSalesRows: normalizeSalesRows,
    buildMM60Map: buildMM60Map,
    normalizeItemCostMap: normalizeItemCostMap,
    buildGLMap: buildGLMap,
    aggregateSales: aggregateSales,
    aggregateTargets: aggregateTargets,
    aggregateExpenses: aggregateExpenses,
    buildDataset: buildDataset,
    computeKPIs: computeKPIs
  };
})();
