const SPREADSHEET_ID = "1pnHMODEpRJbcfA2-z6hyDngwRgd4_tAznv5LMP5SoDs";
const PRIMARY_SHEET = "Daily Data";
const DETAIL_SHEET = "General Data";
const OVERALL = "Overall";
const AUTO_REFRESH_MS = 30000;
const DEBUG_DASHBOARD = true;

const state = {
  rawRows: [],
  rows: [],
  columns: [],
  fields: {},
  detailRows: [],
  detailColumns: [],
  detailFields: {},
  campaignLabels: new Map(),
  activeSource: "daily",
  hasLoaded: false,
  refreshTimer: null,
  isRefreshing: false,
  filters: {
    campaign: OVERALL,
    campaignSearch: "",
    dateFrom: "",
    dateTo: "",
    store: OVERALL,
    region: OVERALL,
  },
};

const els = {
  loader: document.getElementById("loader"),
  toast: document.getElementById("toast"),
  sourceDot: document.getElementById("sourceDot"),
  sourceStatus: document.getElementById("sourceStatus"),
  realtimeStatus: document.getElementById("realtimeStatus"),
  lastUpdated: document.getElementById("lastUpdated"),
  kpis: document.getElementById("overview"),
  campaignFilter: document.getElementById("campaignFilter"),
  campaignSearch: document.getElementById("campaignSearch"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  storeFilter: document.getElementById("storeFilter"),
  storeFilterWrap: document.getElementById("storeFilterWrap"),
  regionFilter: document.getElementById("regionFilter"),
  regionFilterWrap: document.getElementById("regionFilterWrap"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  tableFoot: document.getElementById("tableFoot"),
  rowCount: document.getElementById("rowCount"),
  salesTrendChart: document.getElementById("salesTrendChart"),
  adsTrendChart: document.getElementById("adsTrendChart"),
  campaignChart: document.getElementById("campaignChart"),
  storesChart: document.getElementById("storesChart"),
  productsChart: document.getElementById("productsChart"),
  drilldownDialog: document.getElementById("drilldownDialog"),
  drilldownTitle: document.getElementById("drilldownTitle"),
  drilldownBody: document.getElementById("drilldownBody"),
};

const peso = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const numberFmt = new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric" });

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  wireEvents();
  applySavedTheme();
  await loadData({ reason: "initial" });
  startRealtimeRefresh();
}

function wireEvents() {
  document.getElementById("refreshButton").addEventListener("click", () => loadData({ reason: "manual" }));
  document.getElementById("exportButton").addEventListener("click", exportFilteredTable);
  document.getElementById("printButton").addEventListener("click", () => window.print());
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("closeDialog").addEventListener("click", () => els.drilldownDialog.close());

  els.campaignFilter.addEventListener("change", (event) => {
    state.filters.campaign = event.target.value;
    updateDashboard();
  });
  els.campaignSearch.addEventListener("input", (event) => {
    state.filters.campaignSearch = event.target.value.trim().toLowerCase();
    populateCampaignFilter();
  });
  els.dateFrom.addEventListener("change", (event) => {
    state.filters.dateFrom = event.target.value;
    updateDashboard();
  });
  els.dateTo.addEventListener("change", (event) => {
    state.filters.dateTo = event.target.value;
    updateDashboard();
  });
  els.storeFilter.addEventListener("change", (event) => {
    state.filters.store = event.target.value;
    updateDashboard();
  });
  els.regionFilter.addEventListener("change", (event) => {
    state.filters.region = event.target.value;
    updateDashboard();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRealtimeRefresh();
      setRealtimeStatus("Paused while tab is hidden", "syncing");
    } else {
      startRealtimeRefresh();
      loadData({ reason: "realtime" });
    }
  });
}

async function loadData({ reason = "manual" } = {}) {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  const showOverlay = !state.hasLoaded;
  setLoading(showOverlay);
  setRealtimeStatus(reason === "realtime" ? "Syncing latest data" : "Refreshing data", "syncing");
  setSource(state.hasLoaded ? "Refreshing spreadsheet" : "Connecting to spreadsheet", "");

  try {
    const dailyJson = await loadSheetJsonp(PRIMARY_SHEET);
    const parsed = rowsFromGviz(dailyJson);
    const previousFilters = { ...state.filters };
    let details = { columns: [], rows: [] };

    try {
      const campaignJson = await loadSheetJsonp(DETAIL_SHEET, "select I,J where I is not null", 3);
      const campaignLookup = rowsFromGviz(campaignJson);
      state.campaignLabels = buildCampaignLabels(campaignLookup.rows, detectFields(campaignLookup.columns));
    } catch (campaignError) {
      console.warn("Could not refresh campaign name lookup", campaignError);
    }

    try {
      const detailJson = await loadSheetJsonp(DETAIL_SHEET);
      details = rowsFromGeneralData(detailJson);
    } catch (detailError) {
      console.warn("Could not refresh General Data for campaign names and detail charts", detailError);
      if (!state.hasLoaded) {
        state.detailColumns = [];
        state.detailRows = [];
        state.detailFields = {};
      }
    }

    state.columns = parsed.columns;
    state.rawRows = parsed.rows;
    state.fields = detectFields(state.columns);
    if (details.rows.length || details.columns.length) {
      state.detailColumns = details.columns;
      state.detailRows = details.rows;
      state.detailFields = detectFields(state.detailColumns);
      const detailLabels = buildCampaignLabels(state.detailRows, state.detailFields);
      if (detailLabels.size) state.campaignLabels = detailLabels;
    }

    debugLoadedData(parsed);
    debugLoadedData(details, DETAIL_SHEET);
    console.info("Campaign dropdown options", {
      campaignField: state.detailFields.campaign || state.fields.campaign || null,
      campaignNameField: state.detailFields.campaignName || (state.campaignLabels.size ? "Campaign Name" : null),
      campaignCount: uniqueValues(state.detailFields.campaign ? state.detailRows : state.rawRows, state.detailFields.campaign || state.fields.campaign).length || state.campaignLabels.size,
      sampleLabels: Array.from(state.campaignLabels.entries()).slice(0, 5).map(([id, name]) => id + " - " + name),
    });
    applyFilterDefaults(previousFilters);
    populateFilters();
    updateDashboard();
    state.hasLoaded = true;

    const now = new Date();
    els.lastUpdated.textContent = "Latest refresh: " + dateFmt.format(now) + " " + now.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
    setSource("Connected to " + PRIMARY_SHEET + (state.detailRows.length ? " + " + DETAIL_SHEET : ""), "ready");
    setRealtimeStatus("Live: updates every 30s", "ready");
  } catch (error) {
    console.error(error);
    if (!state.hasLoaded) {
      state.rawRows = [];
      state.rows = [];
      updateDashboard();
    }
    setSource("Unable to read spreadsheet", "error");
    setRealtimeStatus("Live sync issue", "error");
    showToast("Could not refresh Daily Data. The dashboard will try again automatically.");
  } finally {
    state.isRefreshing = false;
    setLoading(false);
  }
}

function startRealtimeRefresh() {
  stopRealtimeRefresh();
  if (document.hidden) return;
  state.refreshTimer = window.setInterval(() => loadData({ reason: "realtime" }), AUTO_REFRESH_MS);
  setRealtimeStatus("Live: updates every 30s", "ready");
}

function stopRealtimeRefresh() {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function loadSheetJsonp(sheetName = PRIMARY_SHEET, query = "", headers = null) {
  return new Promise((resolve, reject) => {
    const callback = "dailyDataCallback_" + Date.now();
    const script = document.createElement("script");
    const cleanup = () => {
      delete window[callback];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Spreadsheet request timed out"));
    }, 30000);

    window[callback] = (json) => {
      clearTimeout(timer);
      cleanup();
      resolve(json);
    };
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("Spreadsheet request failed"));
    };
    let source = "https://docs.google.com/spreadsheets/d/" + SPREADSHEET_ID + "/gviz/tq?sheet=" + encodeSheetName(sheetName) + "&tqx=out:json;responseHandler:" + callback + "&cacheBust=" + Date.now();
    if (query) source += "&tq=" + encodeGvizParam(query);
    if (headers !== null) source += "&headers=" + encodeGvizParam(headers);
    script.src = source;
    document.head.appendChild(script);
  });
}

function encodeSheetName(sheetName) {
  return String(sheetName || "").trim().replace(/ /g, "%20");
}

function encodeGvizParam(value) {
  return String(value || "").trim().replace(/ /g, "%20").replace(/,/g, "%2C");
}

function rowsFromGviz(json) {
  const columns = json.table.cols.map((col, index) => col.label || col.id || "Column " + (index + 1));
  const rows = json.table.rows.map((row) => {
    const item = {};
    columns.forEach((column, index) => {
      const cell = row.c[index];
      item[column] = cell ? cell.f ?? cell.v ?? "" : "";
      item["__raw_" + column] = cell ? cell.v ?? cell.f ?? "" : "";
    });
    return item;
  });
  return { columns, rows };
}

function rowsFromGeneralData(json) {
  const rawColumns = json.table.cols.map((col, index) => col.label || col.id || "Column " + (index + 1));
  const rawRows = json.table.rows.map((row) => rawColumns.map((_, index) => {
    const cell = row.c[index];
    return cell ? cell.f ?? cell.v ?? "" : "";
  }));
  const headerIndex = rawRows.findIndex((row) => row.some((value) => normalize(value) === "campaignid"));
  if (headerIndex < 0) return { columns: [], rows: [] };

  const headerValues = rawRows[headerIndex];
  const columns = rawColumns.map((rawColumn, index) => {
    const header = String(headerValues[index] || "").trim();
    if (header) return makeUniqueHeader(header, index, headerValues);
    if (index === 1 && rawRows.slice(headerIndex + 1).some((row) => parseDate(row[index]))) return "Date";
    return String(rawColumn || "Column " + (index + 1)).trim() || "Column " + (index + 1);
  });

  const rows = rawRows.slice(headerIndex + 1).map((values) => {
    const item = {};
    columns.forEach((column, index) => {
      item[column] = values[index] ?? "";
      item["__raw_" + column] = values[index] ?? "";
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => String(value || "").trim()));

  const salesColumn = inferSalesColumn(columns, rows);
  if (salesColumn && !columns.includes("Sales Amount")) {
    columns.push("Sales Amount");
    rows.forEach((row) => { row["Sales Amount"] = row[salesColumn]; });
  }

  return { columns, rows };
}

function makeUniqueHeader(header, index, allHeaders) {
  const duplicatesBefore = allHeaders.slice(0, index).filter((value) => normalize(value) === normalize(header)).length;
  return duplicatesBefore ? header + " " + (duplicatesBefore + 1) : header;
}

function inferSalesColumn(columns, rows) {
  const ignored = new Set(["Date", "CAMPAIGN ID", "CAMPAIGN NAME", "PRODUCT", "PAGES", "AD ACCOUNT", "CUSTOMER STATUS", "ADS LOCATION", "ADS TARGETING"]);
  let best = null;
  let bestTotal = 0;
  columns.forEach((column) => {
    if (ignored.has(column)) return;
    let total = 0;
    let currencyCount = 0;
    rows.forEach((row) => {
      const text = String(row[column] || "");
      const value = toNumber(text);
      if (value > 0 && /₱|php/i.test(text)) {
        total += value;
        currencyCount += 1;
      }
    });
    if (currencyCount > 0 && total > bestTotal) {
      bestTotal = total;
      best = column;
    }
  });
  return best;
}

function detectFields(columns) {
  const find = (aliases) => {
    const exactAliases = aliases.map(normalize);
    for (const alias of exactAliases) {
      const exact = columns.find((column) => normalize(column) === alias);
      if (exact) return exact;
    }
    for (const alias of exactAliases) {
      const partial = columns.find((column) => normalize(column).includes(alias));
      if (partial) return partial;
    }
    return undefined;
  };

  const fields = {
    date: find(["Date", "Daily Date", "Transaction Date", "transaction_date"]),
    campaign: find(["Campaign ID", "CampaignID", "Campaign", "campaign_id", "campaignId"]),
    campaignName: find(["Campaign Name", "CampaignName", "campaign_name", "campaignName"]),
    ads: find(["ADSPENT", "ADS Quantity", "ADS Qty", "Ads Qty", "Total ADS", "ads_quantity", "ADS BUDGET"]),
    sales: find(["Total Sales", "Sales Amount", "Sales", "Amount", "Revenue", "sales_amount", "CONFIRMED (AMOUNT)", "PROCESSED ORDER VALUE"]),
    store: find(["Store", "Store Name", "Branch", "Outlet", "store_name"]),
    region: find(["Region", "Area", "Territory"]),
    sku: find(["SKU", "Product Code", "Item Code"]),
    product: find(["Product", "Product Name", "SKU", "Item", "Item Name", "product_name"]),
    transactions: find(["Transaction", "Transactions", "TRANS", "Receipt", "Invoice"]),
  };

  debugLog("Detected dashboard fields", fields);
  return fields;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function applyFilterDefaults(previousFilters) {
  state.filters = { ...previousFilters };
  els.campaignSearch.value = state.filters.campaignSearch || "";

  const dates = state.rawRows.map((row) => parseDate(row[getActiveFields().date])).filter(Boolean).sort((a, b) => a - b);
  if (dates.length && (!state.filters.dateFrom || !state.filters.dateTo)) {
    state.filters.dateFrom = toInputDate(dates[0]);
    state.filters.dateTo = toInputDate(dates[dates.length - 1]);
  }
  els.dateFrom.value = state.filters.dateFrom || "";
  els.dateTo.value = state.filters.dateTo || "";
}

function populateFilters() {
  populateCampaignFilter();
  const storeField = state.detailFields.store || getActiveFields().store;
  const regionField = state.detailFields.region || state.fields.region;
  const storeRows = state.detailFields.store ? state.detailRows : state.rawRows;
  const regionRows = state.detailFields.region ? state.detailRows : state.rawRows;
  populateOptionFilter(els.storeFilter, uniqueValues(storeRows, storeField), "store");
  populateOptionFilter(els.regionFilter, uniqueValues(regionRows, regionField), "region");
  els.storeFilterWrap.hidden = !storeField;
  els.regionFilterWrap.hidden = !regionField;
}

function populateCampaignFilter() {
  const campaignField = state.detailFields.campaign || state.fields.campaign;
  const campaignRows = state.detailFields.campaign ? state.detailRows : state.rawRows;
  const allCampaigns = uniqueValues(campaignRows, campaignField);
  const search = state.filters.campaignSearch || "";
  const filtered = allCampaigns.filter((campaign) => {
    const label = getCampaignLabel(campaign).toLowerCase();
    return campaign.toLowerCase().includes(search) || label.includes(search);
  });
  populateSelect(els.campaignFilter, filtered, OVERALL, getCampaignLabel);
  if (![OVERALL, ...allCampaigns].includes(state.filters.campaign)) state.filters.campaign = OVERALL;
  els.campaignFilter.value = filtered.includes(state.filters.campaign) ? state.filters.campaign : OVERALL;
}

function populateOptionFilter(select, values, key) {
  populateSelect(select, values, OVERALL);
  if (![OVERALL, ...values].includes(state.filters[key])) state.filters[key] = OVERALL;
  select.value = state.filters[key];
}

function populateSelect(select, values, overallLabel, labelFormatter = (value) => value) {
  select.innerHTML = "";
  [overallLabel, ...values].forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === overallLabel ? overallLabel : labelFormatter(value);
    select.appendChild(option);
  });
}

function buildCampaignLabels(rows, fields) {
  const labels = new Map();
  if (!fields.campaign) return labels;
  rows.forEach((row) => {
    const id = String(row[fields.campaign] || "").trim();
    const name = fields.campaignName ? String(row[fields.campaignName] || "").trim() : "";
    if (id && name && !labels.has(id)) labels.set(id, name);
  });
  return labels;
}

function getCampaignLabel(campaignId) {
  const id = String(campaignId || "");
  const name = state.campaignLabels.get(id);
  return name ? id + " - " + name : id;
}

function updateDashboard() {
  const sourceRows = shouldUseDetailRows() ? state.detailRows : state.rawRows;
  state.activeSource = shouldUseDetailRows() ? "detail" : "daily";
  state.rows = applyFilters(sourceRows, getActiveFields());
  debugFilterState();
  renderKpis();
  renderCharts();
  renderTable();
}

function applyFilters(rows, fields = state.fields) {
  return rows.filter((row) => {
    const date = parseDate(row[fields.date]);
    const from = state.filters.dateFrom ? new Date(state.filters.dateFrom + "T00:00:00") : null;
    const to = state.filters.dateTo ? new Date(state.filters.dateTo + "T23:59:59") : null;
    return matches(row, fields.campaign, state.filters.campaign)
      && matches(row, fields.store, state.filters.store)
      && matches(row, fields.region, state.filters.region)
      && (!from || (date && date >= from))
      && (!to || (date && date <= to));
  });
}

function shouldUseDetailRows() {
  const hasDetailFilters = state.filters.campaign !== OVERALL || state.filters.store !== OVERALL || state.filters.region !== OVERALL;
  return state.detailRows.length > 0 && (hasDetailFilters || Boolean(state.detailFields.campaign || state.detailFields.product || state.detailFields.store));
}

function getActiveFields() {
  return state.activeSource === "detail" ? state.detailFields : state.fields;
}

function matches(row, field, selected) {
  if (!field || selected === OVERALL) return true;
  return String(row[field] || "") === selected;
}

function renderKpis() {
  const fields = getActiveFields();
  const totalAds = sum(state.rows, fields.ads);
  const totalSales = sum(state.rows, fields.sales);
  const totalStores = uniqueValues(state.rows, fields.store).length || countDistinctFallback(state.rows, "store");
  const skuCount = fields.sku ? uniqueValues(state.rows, fields.sku).length : null;
  const transactions = fields.transactions ? sum(state.rows, fields.transactions) : null;
  const adsCurrency = fields.ads && /(spent|budget|amount|cost)/i.test(fields.ads);
  const cards = [
    { label: "Total ADS", value: adsCurrency ? peso.format(totalAds) : numberFmt.format(totalAds), hint: adsCurrency ? "Filtered ad spend" : "Filtered ADS quantity" },
    { label: "Total Sales", value: peso.format(totalSales), hint: totalSales > 0 ? "Positive sales performance" : "No sales in current view", tone: totalSales > 0 ? "positive" : "negative" },
    { label: "Total Stores", value: numberFmt.format(totalStores), hint: fields.store ? "Distinct stores in view" : "Store field unavailable" },
  ];
  if (skuCount !== null) cards.push({ label: "Total SKU", value: numberFmt.format(skuCount), hint: "Distinct SKU values" });
  if (transactions !== null) cards.push({ label: "Total Transactions", value: numberFmt.format(transactions), hint: "Filtered transaction total" });

  els.kpis.innerHTML = cards.map((card) => '<article class="kpi-card"><span>' + escapeHtml(card.label) + '</span><strong>' + escapeHtml(card.value) + '</strong><div class="kpi-delta ' + (card.tone || "") + '">' + escapeHtml(card.hint) + '</div></article>').join("");
}

function renderCharts() {
  const fields = getActiveFields();
  const dailyRows = applyFilters(state.rawRows, state.fields);
  const salesTrendRows = state.activeSource === "detail" && fields.sales ? state.rows : dailyRows;
  const salesTrendFields = state.activeSource === "detail" && fields.sales ? fields : state.fields;
  const salesTrendData = salesTrendFields.sales ? groupByDate(salesTrendRows, salesTrendFields.sales, salesTrendFields) : [];
  const adsTrendData = state.fields.ads ? groupByDate(dailyRows, state.fields.ads, state.fields) : [];
  const campaignData = fields.campaign && fields.sales ? groupTop(state.rows, fields.campaign, fields.sales, 8).map((item) => ({ ...item, displayKey: getCampaignLabel(item.key) })) : [];
  const storeData = fields.store && fields.sales ? groupTop(state.rows, fields.store, fields.sales, 8) : [];
  const productData = fields.product && fields.sales ? groupTop(state.rows, fields.product, fields.sales, 8) : [];

  debugChartData({ salesTrendData, adsTrendData, campaignData, storeData, productData });

  renderLineChart(els.salesTrendChart, salesTrendData, "Sales", peso, showDateDrilldown, missingTrendMessage(salesTrendFields.date, salesTrendFields.sales, "Sales field not found"));
  renderLineChart(els.adsTrendChart, adsTrendData, "ADS", state.fields.ads && /(spent|budget|amount|cost)/i.test(state.fields.ads) ? peso : numberFmt, showDateDrilldown, missingTrendMessage(state.fields.date, state.fields.ads, "ADS field not found"));
  renderBarChart(els.campaignChart, campaignData, peso, showGroupDrilldown, missingBarMessage(fields.campaign, fields.sales, "Campaign field not found"));
  renderBarChart(els.storesChart, storeData, peso, showGroupDrilldown, missingBarMessage(fields.store, fields.sales, "Store field not found"));
  renderBarChart(els.productsChart, productData, peso, showGroupDrilldown, missingBarMessage(fields.product, fields.sales, "Product/SKU field not found"));
}

function renderLineChart(container, data, label, formatter, onPointClick, emptyMessage = "No matching data") {
  if (!data.length) return emptyChart(container, emptyMessage);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  container.innerHTML = '<div class="actual-summary"><span>Total ' + escapeHtml(label) + '</span><strong>' + escapeHtml(formatter.format(total)) + '</strong></div>'
    + '<div class="actual-table-wrap"><table class="actual-table"><thead><tr><th>Date</th><th class="number">Actual ' + escapeHtml(label) + '</th></tr></thead><tbody>'
    + data.map((item) => '<tr data-key="' + escapeHtml(item.key) + '"><td>' + escapeHtml(shortDate(item.date)) + '</td><td class="number">' + escapeHtml(formatter.format(item.value)) + '</td></tr>').join("")
    + '</tbody></table></div>';
  container.querySelectorAll("tr[data-key]").forEach((row) => row.addEventListener("click", () => onPointClick(row.dataset.key)));
}

function renderBarChart(container, data, formatter, onBarClick, emptyMessage = "No matching data") {
  if (!data.length) return emptyChart(container, emptyMessage);
  const total = data.reduce((sum, item) => sum + item.value, 0);
  container.innerHTML = '<div class="actual-summary"><span>Total</span><strong>' + escapeHtml(formatter.format(total)) + '</strong></div>'
    + '<div class="actual-table-wrap"><table class="actual-table"><thead><tr><th>Name</th><th class="number">Actual Sales</th></tr></thead><tbody>'
    + data.map((item) => {
      const label = item.displayKey || item.key;
      return '<tr data-key="' + escapeHtml(item.key) + '"><td title="' + escapeHtml(label) + '">' + escapeHtml(label) + '</td><td class="number">' + escapeHtml(formatter.format(item.value)) + '</td></tr>';
    }).join("")
    + '</tbody></table></div>';
  container.querySelectorAll("tr[data-key]").forEach((row) => row.addEventListener("click", () => onBarClick(row.dataset.key)));
}

function emptyChart(container, message) {
  container.innerHTML = '<div class="chart-empty">' + escapeHtml(message) + '</div>';
}

function renderTable() {
  const fields = getActiveFields();
  const columnsSource = state.activeSource === "detail" ? state.detailColumns : state.columns;
  const preferred = [fields.date, fields.campaign, fields.ads, fields.sales, fields.store, fields.region, fields.sku, fields.product, fields.transactions].filter(Boolean);
  const extras = columnsSource.filter((column) => !preferred.includes(column)).slice(0, 4);
  const columns = [...preferred, ...extras];

  els.rowCount.textContent = numberFmt.format(state.rows.length) + ' filtered row' + (state.rows.length === 1 ? '' : 's');
  els.tableHead.innerHTML = '<tr>' + columns.map((column) => '<th class="' + (isNumericColumn(column) ? 'number' : '') + '">' + escapeHtml(column) + '</th>').join("") + '</tr>';

  if (!state.rows.length) {
    els.tableBody.innerHTML = '<tr><td colspan="' + Math.max(columns.length, 1) + '">No data matches the selected filters.</td></tr>';
  } else {
    els.tableBody.innerHTML = state.rows.map((row, index) => '<tr data-index="' + index + '">' + columns.map((column) => '<td class="' + (isNumericColumn(column) ? 'number' : '') + '">' + formatCell(row[column], column) + '</td>').join("") + '</tr>').join("");
  }

  els.tableBody.querySelectorAll("tr[data-index]").forEach((tr) => tr.addEventListener("click", () => showRowDrilldown(state.rows[Number(tr.dataset.index)])));
  els.tableFoot.innerHTML = '<tr>' + columns.map((column, index) => {
    if (index === 0) return '<td>TOTAL</td>';
    if (column === getActiveFields().sales) return '<td class="number">' + peso.format(sum(state.rows, column)) + '</td>';
    if (column === getActiveFields().ads && /(spent|budget|amount|cost)/i.test(column)) return '<td class="number">' + peso.format(sum(state.rows, column)) + '</td>';
    if (column === getActiveFields().ads || column === getActiveFields().transactions) return '<td class="number">' + numberFmt.format(sum(state.rows, column)) + '</td>';
    if (column === getActiveFields().store) return '<td class="number">' + numberFmt.format(uniqueValues(state.rows, column).length) + '</td>';
    return '<td></td>';
  }).join("") + '</tr>';
}

function groupByDate(rows, valueField, fields = getActiveFields()) {
  if (!fields.date || !valueField) return [];
  const map = new Map();
  rows.forEach((row) => {
    const date = parseDate(row[fields.date]);
    if (!date) return;
    const key = toInputDate(date);
    map.set(key, (map.get(key) || 0) + toNumber(row[valueField]));
  });
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, date: new Date(key + "T00:00:00"), value }));
}

function groupTop(rows, keyField, valueField, limit) {
  if (!keyField || !valueField) return [];
  const map = new Map();
  rows.forEach((row) => {
    const key = String(row[keyField] || "").trim();
    if (!key) return;
    map.set(key, (map.get(key) || 0) + toNumber(row[valueField]));
  });
  return [...map.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value).slice(0, limit);
}

function showDateDrilldown(dateKey) {
  const rows = state.rows.filter((row) => toInputDate(parseDate(row[getActiveFields().date])) === dateKey);
  openDrilldown("Date: " + shortDate(new Date(dateKey + "T00:00:00")), rows);
}

function showGroupDrilldown(key) {
  const possibleFields = [getActiveFields().campaign, getActiveFields().store, getActiveFields().product].filter(Boolean);
  const rows = state.rows.filter((row) => possibleFields.some((field) => String(row[field]) === key));
  openDrilldown(key, rows);
}

function showRowDrilldown(row) {
  els.drilldownTitle.textContent = row[getActiveFields().campaign] || "Daily row";
  els.drilldownBody.innerHTML = '<div class="detail-grid">' + state.columns.map((column) => '<div class="detail-item"><span>' + escapeHtml(column) + '</span><strong>' + formatCell(row[column], column) + '</strong></div>').join("") + '</div>';
  els.drilldownDialog.showModal();
}

function openDrilldown(title, rows) {
  els.drilldownTitle.textContent = title;
  els.drilldownBody.innerHTML = '<div class="detail-grid"><div class="detail-item"><span>Rows</span><strong>' + numberFmt.format(rows.length) + '</strong></div><div class="detail-item"><span>Total Sales</span><strong>' + peso.format(sum(rows, getActiveFields().sales)) + '</strong></div><div class="detail-item"><span>Total ADS</span><strong>' + formatAdsValue(sum(rows, getActiveFields().ads)) + '</strong></div><div class="detail-item"><span>Stores</span><strong>' + numberFmt.format(uniqueValues(rows, getActiveFields().store).length) + '</strong></div></div>';
  els.drilldownDialog.showModal();
}

function exportFilteredTable() {
  if (!state.rows.length) {
    showToast("There is no filtered data to export.");
    return;
  }
  const exportColumns = state.activeSource === "detail" ? state.detailColumns : state.columns;
  const header = exportColumns.join(",");
  const body = state.rows.map((row) => exportColumns.map((column) => csvEscape(row[column])).join(",")).join("\n");
  const totals = exportColumns.map((column, index) => {
    if (index === 0) return "TOTAL";
    if ([getActiveFields().sales, getActiveFields().ads, getActiveFields().transactions].includes(column)) return sum(state.rows, column);
    return "";
  }).join(",");
  download("daily-performance-" + new Date().toISOString().slice(0, 10) + ".csv", header + "\n" + body + "\n" + totals);
}

function download(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function sum(rows, field) {
  if (!field) return 0;
  return rows.reduce((total, row) => total + toNumber(row[field]), 0);
}

function uniqueValues(rows, field) {
  if (!field) return [];
  return [...new Set(rows.map((row) => String(row[field] || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function countDistinctFallback(rows, word) {
  const field = state.columns.find((column) => normalize(column).includes(word));
  return field ? uniqueValues(rows, field).length : 0;
}

function isNumericColumn(column) {
  return [getActiveFields().ads, getActiveFields().sales, getActiveFields().transactions].includes(column) || state.rows.some((row) => toNumber(row[column]) !== 0);
}

function formatAdsValue(value) {
  return getActiveFields().ads && /(spent|budget|amount|cost)/i.test(getActiveFields().ads) ? peso.format(value) : numberFmt.format(value);
}

function formatCell(value, column) {
  if (column === getActiveFields().sales) return peso.format(toNumber(value));
  if (column === getActiveFields().ads && /(spent|budget|amount|cost)/i.test(column)) return peso.format(toNumber(value));
  if ([getActiveFields().ads, getActiveFields().transactions].includes(column)) return numberFmt.format(toNumber(value));
  const date = column === getActiveFields().date ? parseDate(value) : null;
  if (date) return dateFmt.format(date);
  return escapeHtml(value ?? "");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const cleaned = String(value || "").replace(/[PHPphp₱,\s]/g, "").replace(/[()]/g, "-");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(Math.round((value - 25569) * 86400 * 1000));
  const text = String(value || "").trim();
  if (!text) return null;
  const gviz = text.match(/^Date\((\d+),(\d+),(\d+)/);
  if (gviz) return new Date(Number(gviz[1]), Number(gviz[2]), Number(gviz[3]));
  const withYear = /^[A-Za-z]+\s+\d{1,2}$/.test(text) ? text + ", " + new Date().getFullYear() : text;
  const parsed = new Date(withYear);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toInputDate(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function shortDate(date) {
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(date);
}

function formatCompact(value) {
  return new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? text.slice(0, max - 1) + "..." : text;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function missingTrendMessage(dateField, valueField, valueMessage) {
  if (!dateField) return "Date field not found";
  if (!valueField) return valueMessage;
  return "No matching data";
}

function missingBarMessage(groupField, salesField, groupMessage) {
  if (!groupField) return groupMessage;
  if (!salesField) return "Sales field not found";
  return "No matching data";
}

function debugLog(label, value) {
  if (!DEBUG_DASHBOARD) return;
  console.log("[Dashboard Debug] " + label, value);
}

function debugLoadedData(parsed) {
  if (!DEBUG_DASHBOARD) return;
  console.groupCollapsed("[Dashboard Debug] Loaded data from " + PRIMARY_SHEET);
  console.log("Total rows loaded", parsed.rows.length);
  console.log("Available column headers", parsed.columns);
  console.log("First 5 sample rows", parsed.rows.slice(0, 5));
  console.log("Detected fields", state.fields);
  console.groupEnd();
}

function debugFilterState() {
  if (!DEBUG_DASHBOARD) return;
  console.groupCollapsed("[Dashboard Debug] Filters and filtered rows");
  console.log("Current selected filters", { ...state.filters });
  console.log("Filtered row count", state.rows.length);
  console.groupEnd();
}

function debugChartData(chartData) {
  if (!DEBUG_DASHBOARD) return;
  console.groupCollapsed("[Dashboard Debug] Chart input data");
  console.log("Daily Sales Trend", chartData.salesTrendData);
  console.log("Daily ADS Trend", chartData.adsTrendData);
  console.log("Sales by Campaign", chartData.campaignData);
  console.log("Top Performing Stores", chartData.storeData);
  console.log("Top Selling Products", chartData.productData);
  console.groupEnd();
}

function setLoading(isLoading) {
  els.loader.classList.toggle("hidden", !isLoading);
}

function setSource(message, status) {
  els.sourceStatus.textContent = message;
  els.sourceDot.className = "status-dot " + status;
}

function setRealtimeStatus(message, status) {
  if (!els.realtimeStatus) return;
  els.realtimeStatus.textContent = message;
  els.realtimeStatus.className = "realtime-chip " + (status || "");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 4200);
}

function applySavedTheme() {
  const theme = localStorage.getItem("dashboard-theme") || "light";
  document.documentElement.dataset.theme = theme;
  document.getElementById("themeIcon").textContent = theme === "dark" ? "Light" : "Dark";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("dashboard-theme", next);
  document.getElementById("themeIcon").textContent = next === "dark" ? "Light" : "Dark";
}
