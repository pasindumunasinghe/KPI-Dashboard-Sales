// Ported from the original browser-side calc.js. Business logic is intentionally unchanged;
// it now runs on the server (Express) and is exposed as an ES module instead of window.DashboardCalc.
/* eslint-disable */

  var MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

  function excelSerialToDate(serial: any) {
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

  function monthNameFromSerial(serial: any) {
    var d = excelSerialToDate(serial);
    if (!d) return null;
    var idx = d.getUTCMonth(); // 0=Jan
    var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return names[idx];
  }

  // Derive Main Channel from raw "Distribution Channel" code + "Sales Employee",
  // per the client's channel-mapping formula.
  var MAIN_CHANNEL_MAP: Record<string, string> = {
    '10': 'Distribution', '11': 'Distribution', '12': 'Distribution', '14': 'Distribution',
    '13': 'Digital', '15': 'Digital', '36': 'Digital',
    '20': 'Export', '21': 'Export', '71': 'Export',
    '30': 'Project', '31': 'Project', '32': 'Project', '33': 'Project', '34': 'Project', '35': 'Project',
    '40': 'Retail', '41': 'Retail', '42': 'Retail', '43': 'Retail',
    '51': 'After Sales',
    '52': 'Manufacturing',
    '54': 'Other', '80': 'Other',
    '61': 'Online', '90': 'Business Development', '37': 'Industrial', '38': 'Solar'
  };
  function deriveMainChannel(distributionChannel: any, salesEmployee: any) {
    var code = String(distributionChannel || '').trim();
    if (code === '91') {
      return String(salesEmployee || '').trim() === '10265' ? 'Distribution' : 'Other';
    }
    return MAIN_CHANNEL_MAP[code] || 'Other';
  }

  // Derive Sub Channel from raw "Distribution Channel1" text + "Bill-to Party" + "Sales Employee".
  function deriveSubChannel(distributionChannel1: any, billToParty: any, salesEmployee: any) {
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
  function normalizeSalesRows(rawRows: any) {
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
    var seen: any = {};
    var canonical: any[] = [];
    var RENAME_FIRST_DUP: Record<string, string> = { 'Distribution Channel': 'Distribution Channel1', 'Bill-to Party': 'Bill-to Party1', 'Sales Employee': 'Sales Employee1', 'Plant': 'Plant1', 'Material': 'Material1' };
    var RENAME_DIRECT: any = {};
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
    function parseSapNumber(raw: any) {
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
    var normalizedRows = dataRows.map(function (r: any) {
      if (!r) return r;
      var row = r.slice();
      if (salesOrgIdx !== -1) {
        var org = String(row[salesOrgIdx] || '').trim();
        if (org === 'Orel Ceylon (Pvt) Lt') row[salesOrgIdx] = 'Orel Ceylon (Pvt) Ltd';
      }
      // COGS uses gross sales quantity only — no return/credit-memo netting.
      if (qtyIdx !== -1) {
        var qtyNum = parseFloat(parseSapNumber(row[qtyIdx])) || 0;
        row[qtyIdx] = qtyNum;
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

    var allowedOrgs: Record<string, boolean> = { 'orel corporation': true, 'orel ceylon (pvt) ltd': true };
    if (salesOrgIdx !== -1) {
      normalizedRows = normalizedRows.filter(function (r: any) {
        return r && allowedOrgs[String(r[salesOrgIdx] || '').trim().toLowerCase()];
      });
    }
    return [canonical].concat(normalizedRows);
  }

  function normalizeGLCategory(raw: any) {
    if (!raw) return null;
    var s = String(raw).split(' - ')[0].trim();
    return s === 'Cost Of Sales' ? 'Cost Of Sales' : s;
  }

  // Build a column-name -> index map from a header row (case-insensitive, trimmed).
  function headerMap(headerRow: any) {
    var map: any = {};
    headerRow.forEach(function (h: any, i: any) {
      if (h === undefined || h === null || h === '') return;
      map[String(h).trim().toLowerCase()] = i;
    });
    return map;
  }
  function col(map: any, row: any, name: any) {
    var i = map[name.toLowerCase()];
    if (i === undefined) return undefined;
    return row[i];
  }
  function num(v: any) {
    if (v === undefined || v === null || v === '') return 0;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function isIntegerCode(v: any) {
    return /^\d+$/.test(String(v).trim());
  }

  function deepGet(obj: any, path: any, dflt: any) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null) return dflt;
      cur = cur[path[i]];
    }
    return cur === undefined ? dflt : cur;
  }
  function deepAdd(obj: any, path: any, amount: any) {
    var cur = obj;
    for (var i = 0; i < path.length - 1; i++) {
      var k = path[i];
      if (!cur[k]) cur[k] = {};
      cur = cur[k];
    }
    var last = path[path.length - 1];
    cur[last] = (cur[last] || 0) + amount;
  }

  function makeItemCostKey(material: any, plant: any) {
    return String(material || '').trim().toUpperCase() + '|' + String(plant || '').trim().toUpperCase();
  }

  function buildMM60Map(mm60Rows: any) {
    var map: any = {};
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

  // Full MM60 map keyed by Material+Plant -> { price, materialType }. Material type
  // ('Material type' / 'Material Type' column) drives whether COGS uses MM60 or VK13.
  function buildMM60FullMap(mm60Rows: any) {
    var map: any = {};
    if (!mm60Rows || mm60Rows.length < 2) return map;
    var hm = headerMap(mm60Rows[0]);
    for (var i = 1; i < mm60Rows.length; i++) {
      var r = mm60Rows[i];
      if (!r || !r.length) continue;
      var material = col(hm, r, 'Material');
      var plant = col(hm, r, 'Plant');
      if (material === undefined || plant === undefined) continue;
      var price = num(col(hm, r, 'Price'));
      var materialType = String(col(hm, r, 'Material type') || col(hm, r, 'Material Type') || '').trim().toUpperCase();
      map[makeItemCostKey(material, plant)] = { price: price, materialType: materialType };
    }
    return map;
  }

  // VK13 pricing export comes as a raw SAP fixed-width dump (title rows, blank rows,
  // header labels split with leading padding). Detect the real header row (contains
  // 'Material' and 'Amount' once trimmed) and rebuild canonical trimmed rows from it.
  // Also accepts an already-clean upload with a plain header row.
  function normalizeVK13Rows(rawRows: any) {
    if (!rawRows || !rawRows.length) return [];
    function trimCell(v: any) { return v === undefined || v === null ? '' : String(v).trim(); }
    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(rawRows.length, 40); i++) {
      var row = rawRows[i];
      if (!row) continue;
      var trimmed = row.map(trimCell);
      if (trimmed.indexOf('Material') !== -1 && trimmed.indexOf('Amount') !== -1) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) return [];
    var headerRow = rawRows[headerRowIdx].map(trimCell);
    var materialIdx = headerRow.indexOf('Material');
    var out = [headerRow];
    for (var j = headerRowIdx + 1; j < rawRows.length; j++) {
      var r = rawRows[j];
      if (!r || !r.length) continue;
      var trimmedRow = r.map(trimCell);
      if (!trimmedRow[materialIdx]) continue;
      out.push(trimmedRow);
    }
    return out;
  }

  // VK13 unit-cost map keyed by Material + Distribution Channel (DI column):
  // Local Currency Price = Amount / Per ('per' pricing-unit column — the SAP
  // condition-per-quantity field). Exchange rate handling is unchanged: LKR rows
  // convert directly; non-LKR rows are looked up in a per-currency rate map (rate
  // defaults to 1 if the row's currency isn't in the map — no silent drop).
  // Also returns a materialOnlySet so callers can tell "material exists in VK13
  // but this Distribution Channel doesn't" apart from "material not in VK13 at all".
  function makeVK13Key(material: any, distributionChannel: any) {
    return String(material || '').trim().toUpperCase() + '|' + String(distributionChannel || '').trim().toUpperCase();
  }
  function buildVK13Map(vk13RowsRaw: any, vk13ExchangeRates: any) {
    var map: any = {};
    var materialsPresent: any = {};
    var rows = normalizeVK13Rows(vk13RowsRaw);
    if (!rows || rows.length < 2) return { map: map, materialsPresent: materialsPresent };
    var header = rows[0];
    var materialIdx = header.indexOf('Material');
    var amountIdx = header.indexOf('Amount');
    var currencyIdx = header.indexOf('Unit');
    var perIdx = header.indexOf('per');
    if (perIdx === -1) perIdx = currencyIdx;
    var diIdx = header.findIndex(function (h: any) { return String(h || '').trim().toLowerCase() === 'di'; });
    if (materialIdx === -1 || amountIdx === -1) return { map: map, materialsPresent: materialsPresent };
    var rateMap: any = {};
    (vk13ExchangeRates || []).forEach(function (entry: any) {
      if (entry && entry.currency) rateMap[String(entry.currency).trim().toUpperCase()] = num(entry.rate);
    });
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var material = String(r[materialIdx] || '').trim().toUpperCase();
      if (!material) continue;
      var distributionChannel = diIdx !== -1 ? String(r[diIdx] || '').trim() : '';
      var currency = currencyIdx !== -1 ? String(r[currencyIdx] || '').trim().toUpperCase() : '';
      var amount = num(r[amountIdx]);
      var perUnit = perIdx !== -1 ? num(r[perIdx]) : 1;
      if (!perUnit) perUnit = 1;
      var lkrAmount;
      if (!currency || currency === 'LKR') {
        lkrAmount = amount;
      } else {
        var rate = rateMap.hasOwnProperty(currency) ? rateMap[currency] : 1;
        lkrAmount = amount * rate;
      }
      map[makeVK13Key(material, distributionChannel)] = lkrAmount / perUnit;
      materialsPresent[material] = true;
    }
    return { map: map, materialsPresent: materialsPresent };
  }

  // Precomputed mm60 price maps (loaded from JSON) may have been built with
  // raw, non-normalized keys — re-key them the same way as buildMM60Map so
  // Material+Plant lookups always match regardless of case/whitespace.
  function normalizeItemCostMap(rawMap: any) {
    var map: any = {};
    if (!rawMap) return map;
    Object.keys(rawMap).forEach(function (key: any) {
      var parts = key.split('|');
      var material = parts[0];
      var plant = parts.slice(1).join('|');
      map[makeItemCostKey(material, plant)] = rawMap[key];
    });
    return map;
  }

  function buildGLMap(glRows: any) {
    var map: any = {};
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

  // GL Code -> GL Name lookup from the GL Category Mapping file, used only to show
  // a human-readable expense description in the Selling & Distribution drill-down
  // (and any other GL-level breakdown). Does not affect category totals.
  function buildGLNameMap(glRows: any) {
    var map: any = {};
    if (!glRows || glRows.length < 2) return map;
    var hm = headerMap(glRows[0]);
    for (var i = 1; i < glRows.length; i++) {
      var r = glRows[i];
      if (!r || !r.length) continue;
      var code = col(hm, r, 'GL Code');
      if (code === undefined || code === '') continue;
      var name = col(hm, r, 'GL Name');
      if (name) map[String(code).trim()] = String(name).trim();
    }
    return map;
  }

  // ---- Sales + COGS aggregation ----
  // sales[month][mainChannel][subChannel] = { actual: number, cogs: number }
  // Sub channels with no sales history yet but expected to receive sales in future
  // periods — kept visible in filters/allocation ahead of any data.
  var FUTURE_SUB_CHANNELS = ['Industrial', 'Business Development', 'Solar', 'Online'];

  function aggregateSales(salesRowsRaw: any, mm60FullMap: any, defaultVK13Map: any, mm60SurchargePct: any, vk13MaterialsPresent: any, vk13MapsByMonth?: any) {
    var agg: any = {};
    var mainChannelsSeen: any = {};
    // Distributor sales split by Bill-to Party — feeds the Distribution Cost
    // exclusion rule (Warehouse Cost / Primary Sales are unaffected by this).
    var distributorByBillToParty: any = {};
    // VK13 match validation log: one entry per FERT/HALB sales row, showing
    // Material, Distribution Channel Code, and the match outcome/reason.
    var vk13ValidationLog: any[] = [];
    var salesRows = normalizeSalesRows(salesRowsRaw);
    if (!salesRows || salesRows.length < 2) return { agg: agg, mainChannels: [] };
    var hm = headerMap(salesRows[0]);
    for (var i = 1; i < salesRows.length; i++) {
      var r = salesRows[i];
      if (!r || !r.length) continue;
      var billingDate = col(hm, r, 'Billing Date');
      var month = monthNameFromSerial(billingDate);
      if (!month) continue;
      var vk13Map = (vk13MapsByMonth && vk13MapsByMonth[month]) || defaultVK13Map;
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
      if (sub === 'Intercompany Local' || sub === 'Intercompany - Local') continue;
      if (sub.indexOf('Intercompany') !== -1 && sub.indexOf('Foreign') === -1) continue;
      var salesValue = num(col(hm, r, 'Sales Value'));
      var qty = num(col(hm, r, 'Qty'));
      var material = String(col(hm, r, 'Material') || '').trim();
      var plant = String(col(hm, r, 'Plant') || '').trim();
      var distributionChannelCode = String(distributionChannel || '').trim();
      var mm60Entry = mm60FullMap[makeItemCostKey(material, plant)];
      var materialType = mm60Entry ? String(mm60Entry.materialType || '').trim().toUpperCase() : '';
      var unitCost;
      if (materialType === 'FERT' || materialType === 'HALB') {
        var vk13Key = makeVK13Key(material, distributionChannelCode);
        var materialUpper = material.toUpperCase();
        if (vk13Map && vk13Map.hasOwnProperty(vk13Key)) {
          unitCost = vk13Map[vk13Key];
          vk13ValidationLog.push({ material: material, distributionChannel: distributionChannelCode, reason: 'VK13 Match Found' });
        } else if (vk13MaterialsPresent && vk13MaterialsPresent[materialUpper]) {
          unitCost = 0;
          vk13ValidationLog.push({ material: material, distributionChannel: distributionChannelCode, reason: 'VK13 Distribution Channel Mapping Not Found' });
        } else {
          unitCost = 0;
          vk13ValidationLog.push({ material: material, distributionChannel: distributionChannelCode, reason: 'Material Not Found' });
        }
      } else {
        var basePrice = mm60Entry ? (mm60Entry.price || 0) : 0;
        unitCost = basePrice * (1 + (num(mm60SurchargePct) || 0) / 100);
      }
      var cogs = qty * unitCost;

      mainChannelsSeen[main] = mainChannelsSeen[main] || {};
      mainChannelsSeen[main][sub] = true;

      deepAdd(agg, [month, main, sub, 'actual'], salesValue);
      deepAdd(agg, [month, main, sub, 'cogs'], cogs);

      if (sub === 'Distributor') {
        var billToPartyKey = String(billToParty || '').trim().toUpperCase() || 'UNKNOWN';
        deepAdd(distributorByBillToParty, [month, main, sub, billToPartyKey], salesValue);
      }
    }
    mainChannelsSeen['Other'] = mainChannelsSeen['Other'] || {};
    FUTURE_SUB_CHANNELS.forEach(function (s: any) { mainChannelsSeen['Other'][s] = true; });
    var mainChannels = Object.keys(mainChannelsSeen).sort().map(function (m: any) {
      return { main: m, subs: Object.keys(mainChannelsSeen[m]).sort() };
    });
    return { agg: agg, mainChannels: mainChannels, distributorByBillToParty: distributorByBillToParty, vk13ValidationLog: vk13ValidationLog };
  }

  // targets[month][mainChannel][subChannel] = number
  function aggregateTargets(targetRows: any) {
    var agg: any = {};
    if (!targetRows || targetRows.length < 2) return agg;
    var hm = headerMap(targetRows[0]);
    for (var i = 1; i < targetRows.length; i++) {
      var r = targetRows[i];
      if (!r || !r.length) continue;
      var main = String(col(hm, r, 'Main Channel') || 'Unassigned').trim();
      var sub = String(col(hm, r, 'Sub Channel') || 'Unassigned').trim();
      MONTHS.forEach(function (month: any) {
        var v = num(col(hm, r, month));
        deepAdd(agg, [month, main, sub], v);
      });
    }
    return agg;
  }

  // expenses[month][category] = number  (company-wide; not split by channel — source has no channel dimension)
  // expensesByGL[month][glCode] = { amount, category, description } — same filtered
  // rows as expenses, kept per-G/L-Account purely for category drill-down display.
  // Does not change or feed any existing KPI/category total.
  function aggregateExpenses(expenseRows: any, glMap: any, allowedCompanyCodes: any, glNameMap: any, ccResultForFilter: any) {
    var agg: any = {};
    var byGL: any = {};
    if (!expenseRows || expenseRows.length < 2) return { agg: agg, byGL: byGL };
    var hm = headerMap(expenseRows[0]);
    var allowedSet: Record<string, boolean> | null = null;
    if (allowedCompanyCodes && allowedCompanyCodes.length) {
      var companySet: Record<string, boolean> = {};
      allowedSet = companySet;
      allowedCompanyCodes.forEach(function (c: any) { companySet[String(c).trim()] = true; });
    }
    var descCol = hm['g/l description'] !== undefined ? 'G/L Description' : (hm['account description'] !== undefined ? 'Account Description' : null);
    for (var i = 1; i < expenseRows.length; i++) {
      var r = expenseRows[i];
      if (!r || !r.length) continue;
      var companyCode = col(hm, r, 'Company Code');
      if (companyCode === undefined || !isIntegerCode(companyCode)) continue;
      if (allowedSet && !allowedSet[String(companyCode).trim()]) continue;
      // Only applied when a valid Cost Centers file is uploaded — narrows the
      // matched rows to those resolvable via the master file or the hardcoded
      // direct/range/global/1600-pool rules, per spec. Leaves all totals unchanged
      // when no Cost Centers file has been uploaded.
      if (ccResultForFilter) {
        var ccCode = normalizeCostCenter(col(hm, r, 'Cost Center'));
        if (!ccCode || !resolveCostCenterAllocation(ccCode, ccResultForFilter)) continue;
      }
      var postingDate = col(hm, r, 'Posting Date');
      var month = monthNameFromSerial(postingDate);
      if (!month) continue;
      var glCode = String(col(hm, r, 'G/L Account') || '').trim();
      var category = glMap[glCode];
      if (!category) continue;
      var amount = num(col(hm, r, 'Amount in Local Currency'));
      deepAdd(agg, [month, category], amount);

      if (!byGL[month]) byGL[month] = {};
      if (!byGL[month][glCode]) {
        var desc = descCol ? String(col(hm, r, descCol) || '').trim() : '';
        if (!desc && glNameMap) desc = glNameMap[glCode] || '';
        byGL[month][glCode] = { amount: 0, category: category, description: desc };
      }
      byGL[month][glCode].amount += amount;
    }
    return { agg: agg, byGL: byGL };
  }

  // Drill-down only: groups the SAME filtered expense rows already summed into the
  // category KPI, by G/L Account, for one category across the given months. Total
  // of returned rows always equals the existing category total for those months.
  // GL lines that fold in allocated Warehouse/Distribution-section costs, per spec.
  // Labels used only as a fallback if the GL Category Mapping file has no name for
  // these codes yet (so the breakdown row is still labeled correctly).
  var ALLOCATION_GL_FALLBACK_NAMES: Record<string, string> = {
    '680029': 'Transport Charge Selling & Distribution',
    '680008': 'Rebate & Discount Expenses',
    '700004': 'Interest on STB'
  };

  function computeExpenseCategoryBreakdown(dataset: any, months: any, category: any, mainFilter: any, subFilter: any, extraByGL: any) {
    var main = mainFilter || 'ALL', sub = subFilter || 'ALL';
    var byGLCode: any = {};
    if (main === 'ALL' && sub === 'ALL') {
      (months || []).forEach(function (month: any) {
        var monthGL = dataset.expensesByGL && dataset.expensesByGL[month];
        if (!monthGL) return;
        Object.keys(monthGL).forEach(function (glCode: any) {
          var entry = monthGL[glCode];
          if (entry.category !== category) return;
          if (!byGLCode[glCode]) byGLCode[glCode] = { glAccount: glCode, description: entry.description, amount: 0 };
          byGLCode[glCode].amount += entry.amount;
        });
      });
    } else if (dataset.allocatedExpenseRows) {
      var monthSet: any = {};
      (months || []).forEach(function (m: any) { monthSet[m] = true; });
      dataset.allocatedExpenseRows.forEach(function (rec: any) {
        if (rec.category !== category || !monthSet[rec.month]) return;
        if (main !== 'ALL' && rec.mainChannel !== main) return;
        if (sub !== 'ALL' && rec.subChannel !== sub) return;
        if (!byGLCode[rec.glCode]) byGLCode[rec.glCode] = { glAccount: rec.glCode, description: rec.glName, amount: 0 };
        byGLCode[rec.glCode].amount += rec.amount;
      });
    }
    if (extraByGL) {
      Object.keys(extraByGL).forEach(function (glCode: any) {
        var amt = extraByGL[glCode];
        if (!amt) return;
        if (!byGLCode[glCode]) byGLCode[glCode] = { glAccount: glCode, description: ALLOCATION_GL_FALLBACK_NAMES[glCode] || '', amount: 0 };
        byGLCode[glCode].amount += amt;
      });
    }
    var rows = Object.keys(byGLCode).map(function (k: any) { return byGLCode[k]; });
    rows.sort(function (a: any, b: any) { return b.amount - a.amount; });
    var total = rows.reduce(function (sum: any, r: any) { return sum + r.amount; }, 0);
    return { rows: rows, total: total };
  }

  // ---- Cost Centers (Product Company expense filtering & allocation) ----
  // Independent of every other calculation. When no Cost Centers file has been
  // uploaded, approvedCostCenterSet is null and aggregateExpenses behaves exactly
  // as before (Company Code 1100/1600 only) — existing KPI numbers are unaffected.
  function normalizeCostCenter(value: any) {
    return String(value === undefined || value === null ? '' : value).trim().toUpperCase();
  }

  function buildCostCenterMap(costCenterRows: any) {
    var rowsByCC: any = {};
    var approvedSet: any = {};
    if (costCenterRows && costCenterRows.length > 1) {
      var hm = headerMap(costCenterRows[0]);
      for (var i = 1; i < costCenterRows.length; i++) {
        var r = costCenterRows[i];
        if (!r || !r.length) continue;
        var cc = normalizeCostCenter(col(hm, r, 'Cost Center'));
        if (!cc) continue;
        approvedSet[cc] = true;
        rowsByCC[cc] = {
          name: String(col(hm, r, 'Name') || '').trim(),
          description: String(col(hm, r, 'Description') || '').trim(),
          allocationBase: String(col(hm, r, 'Allocation Base') || '').trim(),
          allocatedChannel: String(col(hm, r, 'Allocated Channel') || '').trim()
        };
      }
    }
    return { rowsByCC: rowsByCC, approvedSet: approvedSet, uniqueCount: Object.keys(approvedSet).length };
  }

  // Authoritative range/instruction definitions per spec — never derived from
  // cost-center number prefixes (wildcard patterns below are explicit spec entries,
  // not inferred). 'X' in a pattern matches exactly one alphanumeric character.
  function ccPatternToRegex(pattern: any) {
    var escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/X/g, '[A-Z0-9]');
    return new RegExp('^' + escaped + '$');
  }
  function ccMatchesAny(cc: any, patterns: any) {
    return patterns.some(function (p: any) { return p.indexOf('X') === -1 ? cc === p : ccPatternToRegex(p).test(cc); });
  }
  // Channel label aliases: spec wording -> actual channel labels used by Target/Sales data.
  var CC_CHANNEL_ALIAS: Record<string, string> = { 'Institution': 'Institutions', 'Qbit': 'QBIT', 'Factory Outlet': 'Factory Outlet - Eka' };
  function ccChannelLabel(name: any) { return CC_CHANNEL_ALIAS[name] || name; }

  var CC_RANGE_DEFS = [
    { parent: '1100700200', channels: ['Direct Dealer', 'Distributor', 'Digital', 'Wireman, Ruhunu & PVC'] },
    { parent: '1100700300', channels: ['Tenders', 'Institutions', 'Contractors', 'Total Solutions', 'Farnell'] },
    { parent: '1100700400', channels: ['International Distributors', 'Online'] },
    { parent: '1100700600', channels: ['QBIT', 'Gangarama'] }
  ];
  var CC_ALL_CHANNEL_EXACT = ['1100700100', '1100700800', '1100700900', '1100700904', '1100700905'];
  var CC_ALL_CHANNEL_PATTERNS = ['110070010X', '110070080X', '110070090X'];
  var CC_1600_POOL_DEFS = [
    { codes: ['1600230100', '160023010X', '1600230200'], channels: ['Direct Dealer', 'Distributor', 'Wireman, Ruhunu & PVC'] },
    { codes: ['1600230300', '1600230400', '1600230450'], channels: ['Direct Dealer', 'Distributor', 'Wireman, Ruhunu & PVC'] },
    { codes: ['1600230430', '1600230440'], channels: ['Direct Dealer', 'Distributor'] }
  ];
  // Direct-assignment table: exact codes first, wildcard patterns after. Both 1100
  // and 1600 direct-assigned children keep their own expense (never re-split).
  var CC_DIRECT_EXACT: Record<string, string> = {
    '1100700201': 'Direct Dealer', '1100700202': 'Distributor', '1100700203': 'Digital',
    '1100700204': 'Wireman, Ruhunu & PVC', '1100700205': 'Modern Trade',
    '1100700901': 'Direct Dealer', '1100700902': 'Distributor',
    '110070022A': 'Distributor', '110070022B': 'Distributor', '110070022C': 'Distributor',
    '110070022D': 'Distributor', '110070022E': 'Distributor', '110070022F': 'Distributor',
    '110070022G': 'Distributor', '110070022H': 'Distributor', '110070022I': 'Distributor', '110070022J': 'Distributor',
    '110070040A': 'International Distributors', '110070040B': 'International Distributors',
    '110070040C': 'International Distributors', '110070040D': 'International Distributors',
    '1100700501': 'Online', '1100700601': 'QBIT', '1100700602': 'Gangarama', '1100700603': 'Factory Outlet - Eka',
    '1600230210': 'Direct Dealer', '1600230220': 'Distributor',
    '160023022A': 'Distributor', '160023022B': 'Distributor', '160023022C': 'Distributor',
    '160023022D': 'Distributor', '160023022E': 'Distributor', '160023022F': 'Distributor',
    '160023022G': 'Distributor', '160023022H': 'Distributor', '160023022I': 'Distributor', '160023022J': 'Distributor',
    '1600230230': 'Digital', '1600230240': 'Wireman, Ruhunu & PVC', '1600230250': 'Modern Trade',
    '1600230410': 'Direct Dealer', '1600230420': 'Distributor'
  };
  var CC_DIRECT_PATTERNS = [
    { pattern: '110070021X', channel: 'Direct Dealer' }, { pattern: '110070022X', channel: 'Distributor' },
    { pattern: '110070023X', channel: 'Digital' }, { pattern: '110070024X', channel: 'Wireman, Ruhunu & PVC' },
    { pattern: '110070031X', channel: 'Tenders' }, { pattern: '110070032X', channel: 'Institutions' },
    { pattern: '110070033X', channel: 'Contractors' }, { pattern: '110070034X', channel: 'Total Solutions' },
    { pattern: '110070035X', channel: 'Farnell' },
    { pattern: '110070041X', channel: 'International Distributors' }, { pattern: '110070050X', channel: 'Online' },
    { pattern: '110070061X', channel: 'QBIT' }, { pattern: '110070062X', channel: 'Gangarama' },
    { pattern: '110070063X', channel: 'Factory Outlet - Eka' }
  ];
  var CC_DO_NOT_ALLOCATE_CENTER = '1100700906';

  // Resolves how a single cost center's expense should be treated. Checked in
  // priority order: excluded -> range/global/1600-pool parent -> hardcoded direct
  // (exact then wildcard) -> master-file Allocated Channel (fallback) -> unresolved.
  function resolveCostCenterAllocation(cc: any, ccResult: any) {
    if (cc === CC_DO_NOT_ALLOCATE_CENTER) return { type: 'excluded' };
    var rangeDef = CC_RANGE_DEFS.filter(function (d: any) { return d.parent === cc; })[0];
    if (rangeDef) return { type: 'range', channels: rangeDef.channels };
    if (CC_ALL_CHANNEL_EXACT.indexOf(cc) !== -1 || ccMatchesAny(cc, CC_ALL_CHANNEL_PATTERNS)) return { type: 'global' };
    var poolDef = CC_1600_POOL_DEFS.filter(function (d: any) { return ccMatchesAny(cc, d.codes); })[0];
    if (poolDef) return { type: 'pool1600', channels: poolDef.channels };
    if (CC_DIRECT_EXACT[cc]) return { type: 'direct', channel: CC_DIRECT_EXACT[cc] };
    var patternHit = CC_DIRECT_PATTERNS.filter(function (p: any) { return ccPatternToRegex(p.pattern).test(cc); })[0];
    if (patternHit) return { type: 'direct', channel: patternHit.channel };
    var masterRow = ccResult.rowsByCC[cc];
    if (masterRow && masterRow.allocatedChannel) return { type: 'direct', channel: ccChannelLabel(masterRow.allocatedChannel) };
    return null;
  }

  // Filters + matches the Expenses Report against the approved Cost Centers set.
  // A cost center counts as "known" if it's in the uploaded master file OR
  // resolvable via the hardcoded direct/range/global/1600-pool rules (parents and
  // wildcard-pattern children are business-confirmed even if the master file omits
  // them as literal rows). Does not allocate — that happens in
  // computeProductCompanyExpenses. Rows failing the Company Code 1100/1600 rule
  // (incl. SAP subtotal/footer rows with a non-integer Company Code) never count
  // as a valid transaction row at all.
  function matchCostCenterExpenses(expenseRows: any, ccResult: any, allowedCompanyCodes: any) {
    var out: any = { validTransactionRows: 0, matchedRows: [], matchedNetAmount: 0, unmatchedCostCenters: {} };
    if (!expenseRows || expenseRows.length < 2 || !ccResult || !ccResult.uniqueCount) return out;
    var hm = headerMap(expenseRows[0]);
    var allowedSet: any = {};
    (allowedCompanyCodes || ['1100', '1600']).forEach(function (c: any) { allowedSet[String(c).trim()] = true; });
    for (var i = 1; i < expenseRows.length; i++) {
      var r = expenseRows[i];
      if (!r || !r.length) continue;
      var companyCode = col(hm, r, 'Company Code');
      if (companyCode === undefined || !isIntegerCode(companyCode)) continue;
      if (!allowedSet[String(companyCode).trim()]) continue;
      out.validTransactionRows++;
      var cc = normalizeCostCenter(col(hm, r, 'Cost Center'));
      if (!cc || !resolveCostCenterAllocation(cc, ccResult)) {
        if (cc) out.unmatchedCostCenters[cc] = (out.unmatchedCostCenters[cc] || 0) + 1;
        continue;
      }
      var amount = num(col(hm, r, 'Amount in Local Currency'));
      var postingDate = col(hm, r, 'Posting Date');
      var month = monthNameFromSerial(postingDate);
      var glCode = String(col(hm, r, 'G/L Account') || '').trim();
      out.matchedRows.push({ cc: cc, amount: amount, glCode: glCode, month: month });
      out.matchedNetAmount += amount;
    }
    return out;
  }

  function sumTargetForLabel(dataset: any, months: any, label: any) {
    var total = 0;
    if (!dataset || !dataset.targets) return total;
    (months || []).forEach(function (month: any) {
      var monthObj = dataset.targets[month];
      if (!monthObj) return;
      Object.keys(monthObj).forEach(function (main: any) {
        var subsObj = monthObj[main];
        if (subsObj && subsObj[label] !== undefined) total += subsObj[label] || 0;
      });
    });
    return total;
  }

  function ccNormalizedTargetPct(dataset: any, months: any, channels: any) {
    var vals = channels.map(function (ch: any) { return { ch: ch, v: sumTargetForLabel(dataset, months, ch) }; });
    var total = vals.reduce(function (s: any, x: any) { return s + x.v; }, 0);
    if (!total) return null;
    var map: any = {};
    vals.forEach(function (x: any) { map[x.ch] = x.v / total; });
    return map;
  }

  function ccEligibleAllChannels(ccResult: any) {
    var exclude: Record<string, boolean> = { 'all channels': true, 'direct dealer & distributor': true };
    var seen: any = {};
    var list: any[] = [];
    Object.keys(ccResult.rowsByCC).forEach(function (cc: any) {
      var row = ccResult.rowsByCC[cc];
      var ch = (row.allocatedChannel || '').trim();
      if (!ch) return;
      var key = ch.toLowerCase();
      if (exclude[key]) return;
      if (/range/i.test(ch)) return;
      if ((row.allocationBase || '').toLowerCase().indexOf('do not allocate') !== -1) return;
      if (!seen[ch]) { seen[ch] = true; list.push(ch); }
    });
    return list;
  }

  // Allocates the matched, cost-center-scoped expense rows to channels per the
  // spec's direct/range/global/1600-pool/excluded rules (resolveCostCenterAllocation),
  // using the dataset's existing Target % as the normalized allocation weight.
  // Direct/child cost centers keep 100% of their own expense; only range/global/pool
  // PARENT postings get split — so parent and child expenses both flow through,
  // never double-allocated. Purely for internal reconciliation/validation — does
  // not feed any displayed KPI.
  function computeProductCompanyExpenses(dataset: any, months: any, matchResult: any, ccResult: any) {
    var result: any = { channelTotals: {}, unallocatedTotal: 0, warnings: [] };
    if (!matchResult || !matchResult.matchedRows.length) return result;
    matchResult.matchedRows.forEach(function (row: any) {
      var cc = row.cc, amount = row.amount;
      var resolved = resolveCostCenterAllocation(cc, ccResult);
      if (!resolved) { result.unallocatedTotal += amount; return; }
      if (resolved.type === 'excluded') { result.unallocatedTotal += amount; return; }
      if (resolved.type === 'direct') {
        result.channelTotals[resolved.channel] = (result.channelTotals[resolved.channel] || 0) + amount;
        return;
      }
      // range, global, or pool1600 — split across the resolved channel group by Target %
      var channels: any[] = resolved.type === 'global' ? ccEligibleAllChannels(ccResult) : (resolved.channels || []);
      var pctMap = ccNormalizedTargetPct(dataset, months, channels);
      if (!pctMap) {
        result.unallocatedTotal += amount;
        result.warnings.push('Target percentages are unavailable for cost center ' + cc + '. The expense has been retained as unallocated.');
      } else {
        channels.forEach(function (ch: any) { result.channelTotals[ch] = (result.channelTotals[ch] || 0) + amount * pctMap[ch]; });
      }
    });
    return result;
  }

  // Flattens matched expense rows into per-channel allocated records using the
  // Cost Center Allocation Engine's own resolution (direct/range/global/1600-pool)
  // — no new mapping invented here. For range/global/pool rows, Target % is
  // computed per the row's OWN month (not the active filter), so this store is
  // filter-independent and can be summed/filtered afterward for any Month/Main/Sub
  // combination. Do-not-allocate (906) and unresolvable rows produce no channel
  // record — they still count in the company-wide (ALL/ALL) total, just not here.
  function buildAllocatedExpenseRecords(dataset: any, matchResult: any, ccResult: any, glMap: any, glNameMap: any, subToMainMap: any) {
    var records: any[] = [];
    if (!matchResult || !matchResult.matchedRows.length) return records;
    matchResult.matchedRows.forEach(function (row: any) {
      var resolved = resolveCostCenterAllocation(row.cc, ccResult);
      if (!resolved || resolved.type === 'excluded') return;
      var category = glMap[row.glCode] || '(unmapped)';
      var glName = (glNameMap && glNameMap[row.glCode]) || '';
      function pushRecord(channel: any, amount: any) {
        if (!amount) return;
        records.push({ month: row.month, mainChannel: subToMainMap[channel] || null, subChannel: channel, category: category, glCode: row.glCode, glName: glName, amount: amount });
      }
      if (resolved.type === 'direct') {
        pushRecord(resolved.channel, row.amount);
        return;
      }
      var channels: any[] = resolved.type === 'global' ? ccEligibleAllChannels(ccResult) : (resolved.channels || []);
      var pctMap = ccNormalizedTargetPct(dataset, [row.month], channels);
      if (!pctMap) return; // no target data for this month/group — retained unallocated, matches reconciliation rule
      channels.forEach(function (ch: any) { pushRecord(ch, row.amount * pctMap[ch]); });
    });
    return records;
  }

  function buildDataset(files: any) {
    var mm60FullMap = buildMM60FullMap(files.mm60Rows);
    var vk13Result = buildVK13Map(files.vk13Rows, files.vk13ExchangeRates);
    // Months with their own month-end rates get their own VK13 map: the month's rates
    // override the defaults per currency; currencies without a month rate keep the default.
    var vk13MapsByMonth: any = {};
    Object.keys(files.vk13ExchangeRatesByMonth || {}).forEach(function (month: any) {
      var monthRates = files.vk13ExchangeRatesByMonth[month];
      var merged = (files.vk13ExchangeRates || []).concat(Object.keys(monthRates).map(function (c: any) { return { currency: c, rate: monthRates[c] }; }));
      vk13MapsByMonth[month] = buildVK13Map(files.vk13Rows, merged).map;
    });
    var glMap = buildGLMap(files.glRows);
    var glNameMap = buildGLNameMap(files.glRows);
    var salesResult = aggregateSales(files.salesRows, mm60FullMap, vk13Result.map, files.mm60SurchargePct, vk13Result.materialsPresent, vk13MapsByMonth);
    var targets = aggregateTargets(files.targetRows);
    var ccResult = buildCostCenterMap(files.costCenterRows);
    var ccResultForFilter = ccResult.uniqueCount > 0 ? ccResult : null;
    var expensesResult = aggregateExpenses(files.expenseRows, glMap, files.allowedCompanyCodes || ['1100', '1600'], glNameMap, ccResultForFilter);
    var allocatedExpenseRows = null;
    if (ccResultForFilter) {
      var subToMainMap: any = {};
      (salesResult.mainChannels || []).forEach(function (mc: any) { (mc.subs || []).forEach(function (s: any) { subToMainMap[s] = mc.main; }); });
      var ccMatchResult = matchCostCenterExpenses(files.expenseRows, ccResult, files.allowedCompanyCodes || ['1100', '1600']);
      var datasetSoFar = { months: MONTHS, targets: targets };
      allocatedExpenseRows = buildAllocatedExpenseRecords(datasetSoFar, ccMatchResult, ccResult, glMap, glNameMap, subToMainMap);
    }
    return {
      months: MONTHS,
      mainChannels: salesResult.mainChannels,
      sales: salesResult.agg,
      distributorByBillToParty: salesResult.distributorByBillToParty,
      vk13ValidationLog: salesResult.vk13ValidationLog,
      targets: targets,
      expenses: expensesResult.agg,
      expensesByGL: expensesResult.byGL,
      allocatedExpenseRows: allocatedExpenseRows,
      costCentersLoaded: ccResult.uniqueCount > 0,
      builtAt: new Date().toISOString()
    };
  }

  // ---- KPI computation from a built dataset given filters ----
  function sumSalesCogs(dataset: any, months: any, main: any, sub: any) {
    var actual = 0, cogs = 0;
    months.forEach(function (month: any) {
      var monthObj = dataset.sales[month];
      if (!monthObj) return;
      var mains = main === 'ALL' ? Object.keys(monthObj) : [main];
      mains.forEach(function (m: any) {
        var subsObj = monthObj[m];
        if (!subsObj) return;
        var subs = sub === 'ALL' ? Object.keys(subsObj) : [sub];
        subs.forEach(function (s: any) {
          var cell = subsObj[s];
          if (!cell) return;
          actual += cell.actual || 0;
          cogs += cell.cogs || 0;
        });
      });
    });
    return { actual: actual, cogs: cogs };
  }

  function sumTarget(dataset: any, months: any, main: any, sub: any) {
    var total = 0;
    months.forEach(function (month: any) {
      var monthObj = dataset.targets[month];
      if (!monthObj) return;
      var mains = main === 'ALL' ? Object.keys(monthObj) : [main];
      mains.forEach(function (m: any) {
        var subsObj = monthObj[m];
        if (!subsObj) return;
        var subs = sub === 'ALL' ? Object.keys(subsObj) : [sub];
        subs.forEach(function (s: any) {
          total += subsObj[s] || 0;
        });
      });
    });
    return total;
  }

  function sumExpenseCategory(dataset: any, months: any, category: any, mainFilter: any = 'ALL', subFilter: any = 'ALL') {
    var main = mainFilter || 'ALL', sub = subFilter || 'ALL';
    // ALL/ALL always takes this identical, untouched path — guarantees expense
    // totals never change when no channel filter is applied.
    if (main === 'ALL' && sub === 'ALL') {
      var total = 0;
      months.forEach(function (month: any) {
        var monthObj = dataset.expenses[month];
        if (!monthObj) return;
        total += monthObj[category] || 0;
      });
      return total;
    }
    // Channel-specific view: use the Cost Center Allocation Engine's per-row
    // channel assignments (only populated when a Cost Centers file is uploaded).
    if (!dataset.allocatedExpenseRows) return 0;
    var monthSet: any = {};
    months.forEach(function (m: any) { monthSet[m] = true; });
    var filtered = 0;
    dataset.allocatedExpenseRows.forEach(function (rec: any) {
      if (rec.category !== category || !monthSet[rec.month]) return;
      if (main !== 'ALL' && rec.mainChannel !== main) return;
      if (sub !== 'ALL' && rec.subChannel !== sub) return;
      filtered += rec.amount;
    });
    return filtered;
  }

  function computeKPIs(dataset: any, filters: any) {
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

    var spi = sumExpenseCategory(dataset, months, 'Sales Performance Incentives', main, sub);
    var gee = sumExpenseCategory(dataset, months, 'General Employee Expenses', main, sub);
    var totalEmployeeRelated = spi + gee;
    var admin = sumExpenseCategory(dataset, months, 'Administration Expenses', main, sub);
    // Warehouse Cost + Delivery Cost fold into the "Transport Charge Selling &
    // Distribution" GL line (680029); Electrician Point folds into "Rebate &
    // Discount Expenses" (680008) — both already channel/month-filtered by the
    // caller (same figures shown in the Warehouse & Distribution Cost Allocation
    // section), so this KPI total and its GL breakdown always reconcile.
    var sdAllocationExtra = (filters.warehouseCostAllocated || 0) + (filters.distributionCostAllocated || 0) + (filters.electricianPointAllocated || 0);
    var sd = sumExpenseCategory(dataset, months, 'Selling & Distribution Expenses', main, sub) + sdAllocationExtra;
    var other = sumExpenseCategory(dataset, months, 'Other Expenses', main, sub);
    var badDebt = sumExpenseCategory(dataset, months, 'Bad Debtor Provision', main, sub);
    var totalOperationExpenses = spi + gee + admin + sd + other + badDebt;

    var ebit = grossProfit - totalOperationExpenses;
    var ebitPct = primarySalesActual ? ebit / primarySalesActual : 0;

    var financeCost = sumExpenseCategory(dataset, months, 'Finance Cost') + (filters.debtorInterestAllocated || 0) + (filters.inventoryInterestAllocated || 0);
    var npbt = ebit - financeCost;
    var npbtPct = primarySalesActual ? npbt / primarySalesActual : 0;

    var corporateTax = npbt > 0 ? npbt * (filters.taxRatePct != null ? (filters.taxRatePct / 100) : 0.30) : 0;
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

  // ---- Debtor Interest (Over-60-day debtor aging) ----
  // Independent from Warehouse/Distribution Cost logic — computed from the
  // Debtor Summary Report upload, keyed directly by its Sales Channel column.
  var DEBTOR_CHANNEL_MAP: Record<string, string> = {
    'DIRECT DEALER': 'Direct Dealer',
    'DISTRIBUTOR': 'Distributor',
    'WIREMAN, RUHUNU & PVC': 'Wireman, Ruhunu & PVC',
    'DIGITAL': 'Digital',
    'DIGITAL CORPORATE': 'Digital Corporate',
    'MODERN TRADE': 'Modern Trade',
    'CONTRACTORS': 'Contractors',
    'INSTITUTIONS': 'Institutions',
    'TENDERS': 'Tenders',
    'TOTAL SOLUTIONS': 'Total Solutions',
    'FARNELL': 'Farnell',
    'GANGARAMA': 'Gangarama',
    'QBIT': 'QBIT',
    'INTERNATIONAL DISTRIBUTIONS': 'International Distributors',
    'INTERCOMPANY – FOREIGN': 'Intercompany - Foreign',
    'INTERCOMPANY - FOREIGN': 'Intercompany - Foreign',
    'OEM - EXPORTS': 'OEM - Exports',
    'AFTERSALES': 'After Sales',
    'FACTORY OUTLET - EKALA': 'Factory Outlet - Eka',
    'RH/SPECIAL ADMIN': 'Special Admin',
    'ONLINE': 'Online',
    'RAW MATERIALS': 'Raw Materials',
    'OTHER': 'Other',
    'WELFARE': 'Welfare'
  };
  function deriveDebtorChannel(salesChannel: any) {
    var key = String(salesChannel || '').trim().toUpperCase();
    return DEBTOR_CHANNEL_MAP[key] || 'Other';
  }
  var DEBTOR_INTEREST_RATE = 0.01;

  // Debtor Summary Report columns: Main Channel, Sales Channel, Total Amount,
  // 0-30 Days, 30-60 Days, 60-75 Days, 75-90 Days, Over 90 Days.
  // Over 60 Debtor Value = 60-75 + 75-90 + Over 90 (per Sales Channel row).
  // Debtor Interest = Over 60 Debtor Value * 1%. No Company Code filter (report
  // already scoped to 1100/1600 upstream).
  function computeDebtorInterest(debtorRows: any) {
    var result: any = {
      byChannel: {}, byChannelInterest: {}, byChannelRecordCount: {},
      totalRecordsLoaded: 0, totalOver60Value: 0, totalDebtorInterest: 0
    };
    if (!debtorRows || debtorRows.length < 2) return result;
    var hm = headerMap(debtorRows[0]);

    for (var i = 1; i < debtorRows.length; i++) {
      var r = debtorRows[i];
      if (!r || !r.length) continue;
      result.totalRecordsLoaded++;

      var channel = deriveDebtorChannel(col(hm, r, 'Sales Channel'));
      var d60to75 = num(col(hm, r, '60 - 75 Days'));
      var d75to90 = num(col(hm, r, '75 - 90 Days'));
      var over90 = num(col(hm, r, 'Over 90 Days'));
      var over60Value = d60to75 + d75to90 + over90;

      result.byChannel[channel] = (result.byChannel[channel] || 0) + over60Value;
      result.byChannelRecordCount[channel] = (result.byChannelRecordCount[channel] || 0) + 1;
      result.totalOver60Value += over60Value;
    }
    Object.keys(result.byChannel).forEach(function (ch: any) {
      result.byChannelInterest[ch] = result.byChannel[ch] * DEBTOR_INTEREST_RATE;
      result.totalDebtorInterest += result.byChannelInterest[ch];
    });
    return result;
  }

  var WAREHOUSE_DIST_MAPPING = [
    { code: '11', label: 'Direct Dealer', subs: ['Direct Dealer'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '12', label: 'Distributor', subs: ['Distributor'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '13', label: 'Digital', subs: ['Digital'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '14', label: 'Wireman, Ruhunu & PVC', subs: ['Wireman, Ruhunu & PVC'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '15', label: 'Modern Trade', subs: ['Modern Trade'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '21', label: 'International Distributors', subs: ['International Distributors'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: false },
    { code: '31', label: 'Tenders', subs: ['Tenders'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '32', label: 'Institutions', subs: ['Institutions'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '33', label: 'Contractors', subs: ['Contractors'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '34', label: 'Total Solutions', subs: ['Total Solutions'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '35', label: 'Farnell', subs: ['Farnell'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: false },
    { code: '36', label: 'Digital Corporate', subs: ['Digital Corporate'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '37', label: 'Industrial', subs: ['Industrial'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '38', label: 'Solar', subs: ['Solar'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: false },
    { code: '41', label: 'QBIT', subs: ['QBIT'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '42', label: 'Gangarama', subs: ['Gangarama'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '43', label: 'Factory Outlet - Eka', subs: ['Factory Outlet - Eka'], kpiRequired: true, warehouseApplicable: false, distributionApplicable: false },
    { code: '44', label: 'Vending Sales', subs: ['Vending Sales'], kpiRequired: true, warehouseApplicable: false, distributionApplicable: false },
    { code: '51', label: 'After Sales', subs: ['After Sales'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '52', label: 'OEM - Exports', subs: ['OEM - Exports'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '53', label: 'OEM - Local', subs: ['OEM - Local'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '54', label: 'Raw Materials', subs: ['Raw Materials'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '61', label: 'Online', subs: ['Online'], kpiRequired: true, warehouseApplicable: false, distributionApplicable: false },
    { code: '71', label: 'Intercompany - Foreign', subs: ['Intercompany - Foreign'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '72', label: 'Intercompany - Local', subs: ['Intercompany - Local'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '80', label: 'Orel Spark', subs: ['Orel Spark'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '81', label: 'Welfare', subs: ['Welfare'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '82', label: 'Other', subs: ['Other'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '90', label: 'Business Development', subs: ['Business Development'], kpiRequired: true, warehouseApplicable: true, distributionApplicable: true },
    { code: '91', label: 'Special Admin', subs: ['Special Admin'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '92', label: 'Call Center', subs: ['Call Center'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false },
    { code: '93', label: 'E-Club', subs: ['E-Club'], kpiRequired: false, warehouseApplicable: false, distributionApplicable: false }
  ];
  var TOTAL_WAREHOUSE_COST = 9760000.00;
  var DISTRIBUTION_RATE = 0.0085;
  var ELECTRICIAN_POINT_CHANNELS = ['Direct Dealer', 'Distributor', 'Wireman, Ruhunu & PVC'];
  var INVENTORY_INTEREST_RATE = 0.01;

  // ---- Inventory Interest (Over-90-day inventory aging) ----
  // Independent from every other calculation — computed only from the uploaded
  // Inventory Report. Channel resolved via Channel name (same naming as
  // DEBTOR_CHANNEL_MAP) or, failing that, Channel Code (same codes as
  // WAREHOUSE_DIST_MAPPING). Unmapped rows are skipped, not guessed.
  function deriveInventoryChannel(channelName: any, channelCode: any) {
    var byName = DEBTOR_CHANNEL_MAP[String(channelName || '').trim().toUpperCase()];
    if (byName) return byName;
    var byCode = WAREHOUSE_DIST_MAPPING.filter(function (m: any) { return m.code === String(channelCode || '').trim(); })[0];
    return byCode ? byCode.label : null;
  }
  // If the report has a Month column, rows are scoped to the selected Month
  // filter (same behavior as other uploaded reports); if it doesn't, every row
  // counts regardless of Month, same as Debtor Interest does today.
  function computeInventoryInterest(inventoryRows: any, monthFilter: any) {
    var result: any = { byChannelInterest: {}, totalInventoryInterest: 0 };
    if (!inventoryRows || inventoryRows.length < 2) return result;
    var hm = headerMap(inventoryRows[0]);
    var hasMonthCol = hm['month'] !== undefined;
    for (var i = 1; i < inventoryRows.length; i++) {
      var r = inventoryRows[i];
      if (!r || !r.length) continue;
      if (hasMonthCol && monthFilter && monthFilter !== 'ALL') {
        var rawMonth = col(hm, r, 'Month');
        var rowMonth = typeof rawMonth === 'number' ? monthNameFromSerial(rawMonth) : String(rawMonth || '').trim();
        if (rowMonth !== monthFilter) continue;
      }
      var channel = deriveInventoryChannel(col(hm, r, 'Channel') || col(hm, r, 'Sub Channel'), col(hm, r, 'Channel Code'));
      if (!channel) continue;
      var over90 = num(col(hm, r, 'Over 90 Days Value'));
      if (!over90) over90 = num(col(hm, r, 'Total Over 90 Days Value'));
      var interest = over90 * INVENTORY_INTEREST_RATE;
      result.byChannelInterest[channel] = (result.byChannelInterest[channel] || 0) + interest;
      result.totalInventoryInterest += interest;
    }
    return result;
  }

  // Default Distributor Delivery Cost exclusion list (Bill-to Party codes) — used
  // whenever no exclusion-list file has been uploaded. Configurable, not hardcoded
  // into the calculation itself: replaced entirely by an uploaded file's contents.
  var DEFAULT_DISTRIBUTOR_EXCLUSION = [
    '02IU01', '07DA01', '08PE02', '09GA01', '10TE01', '11RD01', '13CS01', '13KN01',
    '13PL01', '14MH01', '16AM01', '17CI01', '18AR01', '18MK01', '18RM03', '19WN01',
    '21DD01', '21DE02', '21MA01', '21SE10', '22KG01', '22MP04', '22SE11', '22TA01',
    '23HD01', '23TD01', '23YA01', '24NT03', '25ET02', '25ID01', '25NA01', '25RD02'
  ];

  // Parses an uploaded exclusion-list file (xlsx rows, or CSV split into rows) into
  // a Set of trimmed, uppercased Bill-to Party codes. Picks a 'Bill To Party' /
  // 'Bill-to Party' column if present, else falls back to the first column.
  function buildDistributorExclusionSet(exclusionRows: any) {
    var codes: any[] = [];
    if (exclusionRows && exclusionRows.length) {
      var header = exclusionRows[0] || [];
      var normalizedHeader = header.map(function (h: any) { return String(h || '').trim().toLowerCase(); });
      var idx = normalizedHeader.findIndex(function (h: any) { return h === 'bill to party' || h === 'bill-to party'; });
      var startRow = idx !== -1 ? 1 : 0;
      if (idx === -1) idx = 0;
      for (var i = startRow; i < exclusionRows.length; i++) {
        var row = exclusionRows[i];
        if (!row || !row.length) continue;
        var code = String(row[idx] || '').trim();
        if (code) codes.push(code);
      }
    } else {
      codes = DEFAULT_DISTRIBUTOR_EXCLUSION;
    }
    var set: any = {};
    codes.forEach(function (c: any) { set[String(c).trim().toUpperCase()] = true; });
    return set;
  }

  // Independent allocation calc — does not touch COGS/GP/Cost of Sales/EBIT/etc.
  // Aggregates Primary (Actual) Sales per mapped channel across ALL months/main
  // channels in the dataset (respecting active filters), then allocates the fixed
  // Warehouse Cost pool only among warehouse-applicable channels (proportional to
  // their share of eligible sales) and the 0.85% Distribution Cost only to
  // distribution-applicable channels. Not-applicable channels stay visible with 0.
  // Negative sales values are kept as-is in every total.
  function computeWarehouseDistributionAllocation(dataset: any, filters: any) {
    filters = filters || {};
    var months = filters.month && filters.month !== 'ALL' ? [filters.month] : (dataset ? dataset.months : []);
    var mainFilter = filters.mainChannel || 'ALL';
    var subFilter = filters.subChannel || 'ALL';
    var exclusionSet = buildDistributorExclusionSet(filters.distributorExclusionRows);
    function subChannelActualTotal(subNames: any) {
      var total = 0;
      if (!dataset || !dataset.sales) return total;
      months.forEach(function (month: any) {
        var monthObj = dataset.sales[month];
        if (!monthObj) return;
        Object.keys(monthObj).forEach(function (main: any) {
          if (mainFilter !== 'ALL' && main !== mainFilter) return;
          var subsObj = monthObj[main];
          subNames.forEach(function (subName: any) {
            if (subFilter !== 'ALL' && subName !== subFilter) return;
            var cell = subsObj[subName];
            if (cell) total += cell.actual || 0;
          });
        });
      });
      return total;
    }
    // Warehouse allocation base is always the FULL, unfiltered sales population —
    // percentages/cost per channel must not change when Month/Main/Sub filters are
    // applied; only which rows are displayed changes (via the row filter below).
    function subChannelActualTotalUnfiltered(subNames: any) {
      var total = 0;
      if (!dataset || !dataset.sales) return total;
      (dataset.months || []).forEach(function (month: any) {
        var monthObj = dataset.sales[month];
        if (!monthObj) return;
        Object.keys(monthObj).forEach(function (main: any) {
          var subsObj = monthObj[main];
          subNames.forEach(function (subName: any) {
            var cell = subsObj[subName];
            if (cell) total += cell.actual || 0;
          });
        });
      });
      return total;
    }
    // Distributor-only split: eligible (not in exclusion list) vs excluded sales,
    // used solely to compute Distribution Cost. Primary Sales / Warehouse Cost for
    // Distributor are unaffected — they keep using subChannelActualTotal above.
    function distributorEligibleExcludedTotals() {
      var eligible = 0, excluded = 0, excludedCount = 0, matchedCount = 0;
      if (!dataset || !dataset.distributorByBillToParty) return { eligible: eligible, excluded: excluded, excludedCount: excludedCount, matchedCount: matchedCount };
      months.forEach(function (month: any) {
        var monthObj = dataset.distributorByBillToParty[month];
        if (!monthObj) return;
        Object.keys(monthObj).forEach(function (main: any) {
          if (mainFilter !== 'ALL' && main !== mainFilter) return;
          var subsObj = monthObj[main];
          if (!subsObj || !subsObj['Distributor']) return;
          if (subFilter !== 'ALL' && subFilter !== 'Distributor') return;
          var byParty = subsObj['Distributor'];
          Object.keys(byParty).forEach(function (partyCode: any) {
            var amount = byParty[partyCode] || 0;
            if (exclusionSet[partyCode]) {
              excluded += amount;
              excludedCount++;
              matchedCount++;
            } else {
              eligible += amount;
            }
          });
        });
      });
      return { eligible: eligible, excluded: excluded, excludedCount: excludedCount, matchedCount: matchedCount };
    }

    var rows = WAREHOUSE_DIST_MAPPING
      .filter(function (m: any) { return m.kpiRequired; })
      .filter(function (m: any) { return subFilter === 'ALL' || m.subs.indexOf(subFilter) !== -1; })
      .map(function (m: any) {
        return { code: m.code, label: m.label, subs: m.subs, warehouseApplicable: m.warehouseApplicable, distributionApplicable: m.distributionApplicable, primarySales: subChannelActualTotal(m.subs), warehouseBaseSales: subChannelActualTotalUnfiltered(m.subs) };
      });

    var totalEligibleSales = 0;
    WAREHOUSE_DIST_MAPPING.filter(function (m: any) { return m.kpiRequired && m.warehouseApplicable; }).forEach(function (m: any) {
      totalEligibleSales += subChannelActualTotalUnfiltered(m.subs);
    });

    var distributorSplit = distributorEligibleExcludedTotals();
    var debtorResult = computeDebtorInterest(filters.debtorRows);

    // Electrician Point — a manually-entered value (not a file upload), split only
    // across Direct Dealer / Distributor / Wireman, Ruhunu & PVC using the same
    // Target % basis as the rest of this section (respects the active Month
    // filter, same as `months` above; ignores Main/Sub Channel filters for the
    // split itself — those only control which rows are shown, same as every other
    // column here).
    var electricianPointValue = Number(filters.electricianPointValue) || 0;
    var electricianPointPctMap = electricianPointValue ? ccNormalizedTargetPct(dataset, months, ELECTRICIAN_POINT_CHANNELS) : null;

    var inventoryResult = computeInventoryInterest(filters.inventoryRows, filters.month || 'ALL');

    rows.forEach(function (r: any) {
      if (!r.warehouseApplicable || r.warehouseBaseSales === 0) {
        r.warehouseAllocationPct = 0;
        r.warehouseCost = 0;
      } else {
        r.warehouseAllocationPct = totalEligibleSales !== 0 ? (r.warehouseBaseSales / totalEligibleSales) : 0;
        r.warehouseCost = r.warehouseAllocationPct * TOTAL_WAREHOUSE_COST;
      }
      if (!r.distributionApplicable || r.primarySales === 0) {
        r.distributionCost = 0;
      } else if (r.label === 'Distributor') {
        r.distributionCost = distributorSplit.eligible * DISTRIBUTION_RATE;
      } else {
        r.distributionCost = r.primarySales * DISTRIBUTION_RATE;
      }
      r.debtorInterest = debtorResult.byChannelInterest[r.label] || 0;
      r.electricianPoint = (electricianPointPctMap && ELECTRICIAN_POINT_CHANNELS.indexOf(r.label) !== -1) ? electricianPointValue * electricianPointPctMap[r.label] : 0;
      r.inventoryInterest = inventoryResult.byChannelInterest[r.label] || 0;
    });

    var totalElectricianPointAllocated = 0;
    rows.forEach(function (r: any) { totalElectricianPointAllocated += r.electricianPoint; });
    var totalInventoryInterestAllocated = 0;
    rows.forEach(function (r: any) { totalInventoryInterestAllocated += r.inventoryInterest; });

    var totalWarehouseAllocated = 0, totalDistributionAllocated = 0, totalDebtorInterestDisplayed = 0;
    // Total warehouse cost allocated is always the full pool, computed across every
    // warehouse-applicable channel regardless of which rows are currently displayed.
    WAREHOUSE_DIST_MAPPING.filter(function (m: any) { return m.kpiRequired && m.warehouseApplicable; }).forEach(function (m: any) {
      var base = subChannelActualTotalUnfiltered(m.subs);
      if (base !== 0 && totalEligibleSales !== 0) totalWarehouseAllocated += (base / totalEligibleSales) * TOTAL_WAREHOUSE_COST;
    });
    rows.forEach(function (r: any) { totalDistributionAllocated += r.distributionCost; totalDebtorInterestDisplayed += r.debtorInterest; });

    return {
      rows: rows,
      totalEligibleSales: totalEligibleSales,
      totalWarehouseAllocated: totalWarehouseAllocated,
      totalDistributionAllocated: totalDistributionAllocated,
      totalDebtorInterest: totalDebtorInterestDisplayed,
      totalElectricianPointAllocated: totalElectricianPointAllocated,
      electricianPointValue: electricianPointValue,
      totalInventoryInterestAllocated: totalInventoryInterestAllocated,
      distributorValidation: {
        totalDistributorSales: distributorSplit.eligible + distributorSplit.excluded,
        eligibleDistributorSales: distributorSplit.eligible,
        excludedDistributorSales: distributorSplit.excluded,
        distributionCostBeforeExclusion: (distributorSplit.eligible + distributorSplit.excluded) * DISTRIBUTION_RATE,
        distributionCostAfterExclusion: distributorSplit.eligible * DISTRIBUTION_RATE,
        excludedDistributorCount: distributorSplit.excludedCount,
        matchedBillToPartyRecords: distributorSplit.matchedCount
      },
      debtorValidation: debtorResult
    };
  }

  // ---- Monthly KPI Snapshot (Monthly Comparison tab) ----
  // Snapshot captures the calculation engine's OUTPUT for one month — it never
  // re-reads Excel files or recalculates; the comparison tab reads only these.
  function buildMonthlySnapshot(dataset: any, opts: any) {
    opts = opts || {};
    var month = opts.month;
    var kpi = computeKPIs(dataset, { month: month, mainChannel: 'ALL', subChannel: 'ALL', gpTargetPct: opts.gpTargetPct != null ? opts.gpTargetPct : 20, npatTargetPct: opts.npatTargetPct != null ? opts.npatTargetPct : 10, taxRatePct: opts.taxRatePct });
    var alloc = computeWarehouseDistributionAllocation(dataset, { month: month, mainChannel: 'ALL', subChannel: 'ALL', distributorExclusionRows: opts.distributorExclusionRows, debtorRows: opts.debtorRows, electricianPointValue: opts.electricianPointValue, inventoryRows: opts.inventoryRows });

    var mainChannelBreakdown = (dataset.mainChannels || []).map(function (mc: any) {
      var sales = 0, cogsSum = 0;
      var monthObj = dataset.sales[month];
      if (monthObj && monthObj[mc.main]) {
        Object.keys(monthObj[mc.main]).forEach(function (sub: any) {
          var cell = monthObj[mc.main][sub];
          sales += cell.actual || 0;
          cogsSum += cell.cogs || 0;
        });
      }
      return { channel: mc.main, sales: sales, cogs: cogsSum, grossProfit: sales - cogsSum };
    });

    return {
      financialYear: opts.financialYear || 'FY26/27',
      month: month,
      uploadDate: opts.uploadDate || new Date().toISOString(),
      snapshotCreatedDate: new Date().toISOString(),
      version: opts.version || 1,
      kpis: {
        primarySales: kpi.primarySales.actual,
        cogs: kpi.cogs,
        costOfSalesGL: kpi.costOfSalesGL,
        costOfSalesTotal: kpi.costOfSalesTotal,
        grossProfit: kpi.grossProfit,
        grossProfitPct: kpi.grossProfitPct.actual,
        totalCostOfSales: kpi.costOfSalesTotal,
        spi: kpi.expenses.spi,
        gee: kpi.expenses.gee,
        admin: kpi.expenses.admin,
        sd: kpi.expenses.sd,
        other: kpi.expenses.other,
        badDebt: kpi.expenses.badDebt,
        totalOperationExpenses: kpi.expenses.totalOperationExpenses,
        ebit: kpi.ebit,
        ebitPct: kpi.ebitPct,
        financeCost: kpi.financeCost,
        npbt: kpi.npbt,
        npbtPct: kpi.npbtPct,
        corporateTax: kpi.corporateTax,
        npat: kpi.npat,
        npatPct: kpi.npatPct.actual,
        warehouseCost: alloc.totalWarehouseAllocated,
        distributionCost: alloc.totalDistributionAllocated,
        warehouseDeliveryCost: alloc.totalWarehouseAllocated + alloc.totalDistributionAllocated,
        debtorInterest: alloc.totalDebtorInterest,
        electricianPoint: alloc.totalElectricianPointAllocated,
        inventoryInterest: alloc.totalInventoryInterestAllocated
      },
      mainChannelBreakdown: mainChannelBreakdown
    };
  }

  export const DashboardCalc: any = {
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
    computeWarehouseDistributionAllocation: computeWarehouseDistributionAllocation,
    computeDebtorInterest: computeDebtorInterest,
    deriveDebtorChannel: deriveDebtorChannel,
    buildDistributorExclusionSet: buildDistributorExclusionSet,
    DEFAULT_DISTRIBUTOR_EXCLUSION: DEFAULT_DISTRIBUTOR_EXCLUSION,
    buildMM60FullMap: buildMM60FullMap,
    buildVK13Map: buildVK13Map,
    makeVK13Key: makeVK13Key,
    normalizeVK13Rows: normalizeVK13Rows,
    buildDataset: buildDataset,
    computeExpenseCategoryBreakdown: computeExpenseCategoryBreakdown,
    computeKPIs: computeKPIs,
    buildMonthlySnapshot: buildMonthlySnapshot,
    normalizeCostCenter: normalizeCostCenter,
    buildCostCenterMap: buildCostCenterMap,
    matchCostCenterExpenses: matchCostCenterExpenses,
    computeProductCompanyExpenses: computeProductCompanyExpenses,
    resolveCostCenterAllocation: resolveCostCenterAllocation,
    buildAllocatedExpenseRecords: buildAllocatedExpenseRecords,
    computeInventoryInterest: computeInventoryInterest,
    excelSerialToDate: excelSerialToDate,
    monthNameFromSerial: monthNameFromSerial,
    buildGLNameMap: buildGLNameMap,
    deriveInventoryChannel: deriveInventoryChannel
  };
