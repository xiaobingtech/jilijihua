var STORAGE_KEY = 'MAU_PLUGIN_DATA';
var PERF_STORAGE_KEY = 'MAU_PLUGIN_PERF_DATA';
var allAppData = [];
var storedDataCache = {};
var perfDataCache = {};
var isLightTheme = false;
var cardChartInstances = {};

// ===== Theme =====
function getSystemPrefersLight() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
}

function applyTheme(pref) {
  // pref: 'system' | 'light' | 'dark'
  var shouldBeLight = pref === 'light' || (pref !== 'dark' && getSystemPrefersLight());
  document.body.classList.toggle('light-theme', shouldBeLight);
  isLightTheme = shouldBeLight;
}

function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem('incentive_theme'); } catch(e) {}
  var pref = (saved === 'light' || saved === 'dark') ? saved : 'system';
  applyTheme(pref);
  updateThemeIcon();
}

function updateThemeIcon() {
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  var saved = null;
  try { saved = localStorage.getItem('incentive_theme'); } catch(e) {}
  var pref = (saved === 'light' || saved === 'dark') ? saved : 'system';
  if (pref === 'system') {
    btn.innerHTML = '&#9881;'; // gear icon for system
    btn.title = '当前: 跟随系统 (点击切换)';
  } else if (pref === 'light') {
    btn.innerHTML = '&#9788;'; // sun
    btn.title = '当前: 浅色模式 (点击切换)';
  } else {
    btn.innerHTML = '&#9790;'; // moon
    btn.title = '当前: 深色模式 (点击切换)';
  }
}

function toggleTheme() {
  // Cycle: system → light → dark → system
  var saved = null;
  try { saved = localStorage.getItem('incentive_theme'); } catch(e) {}
  var current = (saved === 'light' || saved === 'dark') ? saved : 'system';
  var next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  try { localStorage.setItem('incentive_theme', next); } catch(e) {}
  applyTheme(next);
  updateThemeIcon();
  disposeCardCharts();
  renderCards();
}

function systemThemeListener() {
  if (!window.matchMedia) return;
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function() {
    var saved = null;
    try { saved = localStorage.getItem('incentive_theme'); } catch(e) {}
    if (!saved || saved === 'system') {
      var wasLight = isLightTheme;
      applyTheme('system');
      if (wasLight !== isLightTheme) {
        updateThemeIcon();
        disposeCardCharts();
        renderCards();
      }
    }
  });
}

// ===== Data Loading =====
function getTodayKey() {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}

function getPreviousDayKey(today) {
  var parts = today.split('-');
  var dt = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  dt.setDate(dt.getDate() - 1);
  var y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
}

function loadStoredData() {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({ action: 'getStatsData' }, function(response) {
      if (chrome.runtime.lastError) { resolve({}); return; }
      resolve(response && response.success ? (response.data || {}) : {});
    });
  });
}

function loadPerfData() {
  return new Promise(function(resolve) {
    chrome.runtime.sendMessage({ action: 'getPerfData' }, function(response) {
      if (chrome.runtime.lastError) { resolve({}); return; }
      resolve(response && response.success ? (response.data || {}) : {});
    });
  });
}

// ===== Main Render =====
function renderStats() {
  var todayKey = getTodayKey();
  document.getElementById('statsDate').textContent = todayKey;

  Promise.all([loadStoredData(), loadPerfData()]).then(function(results) {
    storedDataCache = results[0];
    perfDataCache = results[1];
    var todayData = storedDataCache[todayKey] || {};
    var prevKey = getPreviousDayKey(todayKey);
    var prevData = storedDataCache[prevKey] || {};

    if (!prevData || Object.keys(prevData).length === 0) {
      var keys = Object.keys(storedDataCache).sort();
      for (var i = keys.length - 1; i >= 0; i--) {
        if (keys[i] < todayKey && storedDataCache[keys[i]] && Object.keys(storedDataCache[keys[i]]).length > 0) {
          prevData = storedDataCache[keys[i]];
          break;
        }
      }
    }
    if (!prevData) prevData = {};

    allAppData = [];
    var passCount = 0, failCount = 0, mauPassCount = 0;
    var appList = Object.keys(todayData);

    appList.forEach(function(appName) {
      var info = todayData[appName];
      var maxMau = parseInt(info.maxMau, 10) || 0;
      var score = parseFloat(info.score) || 0;
      var scoreCount = parseInt(info.scoreCount, 10) || 0;
      var currentMau = parseInt(info.currentMau, 10) || 0;

      if (maxMau >= 400) mauPassCount++;

      var yesterdayIncrease = 0;
      if (prevData[appName]) {
        yesterdayIncrease = currentMau - (parseInt(prevData[appName].currentMau, 10) || 0);
      } else {
        yesterdayIncrease = currentMau;
      }

      var qualified = maxMau >= 400 && score >= 3 && scoreCount >= 10;
      if (qualified) passCount++; else failCount++;

      allAppData.push({
        appName: appName,
        maxMau: maxMau,
        score: score,
        scoreCount: scoreCount,
        currentMau: currentMau,
        qualified: qualified,
        yesterdayIncrease: yesterdayIncrease
      });
    });

    // Sort by maxMau desc by default
    allAppData.sort(function(a, b) { return b.maxMau - a.maxMau; });

    var totalCount = allAppData.length;
    document.getElementById('totalCount').textContent = totalCount;
    document.getElementById('passCount').textContent = passCount;
    document.getElementById('failCount').textContent = failCount;
    document.getElementById('mauPassCount').textContent = mauPassCount;
    document.getElementById('passRate').textContent = totalCount > 0 ? ((passCount / totalCount) * 100).toFixed(1) + '%' : '0%';
    document.getElementById('mauPassRate').textContent = totalCount > 0 ? ((mauPassCount / totalCount) * 100).toFixed(1) + '%' : '0%';

    renderCards();
  });
}

// ===== Card Chart Management =====
function disposeCardCharts() {
  Object.keys(cardChartInstances).forEach(function(key) {
    if (cardChartInstances[key]) {
      cardChartInstances[key].dispose();
    }
  });
  cardChartInstances = {};
}

// ===== Filter =====
function getFilteredData() {
  var nameFilter = document.getElementById('nameFilter').value.trim().toLowerCase();
  var statusFilter = document.getElementById('statusFilter').value;

  return allAppData.filter(function(app) {
    var nameMatch = !nameFilter || app.appName.toLowerCase().indexOf(nameFilter) >= 0;
    var mauQualified = app.maxMau >= 400;
    var statusMatch = statusFilter === 'all' ||
      (statusFilter === 'pass' && app.qualified) ||
      (statusFilter === 'fail' && !app.qualified) ||
      (statusFilter === 'mau-pass' && mauQualified) ||
      (statusFilter === 'mau-fail' && !mauQualified);
    return nameMatch && statusMatch;
  });
}

// ===== Render Cards =====
function renderCards() {
  var grid = document.getElementById('cardsGrid');
  var data = getFilteredData();

  document.getElementById('toolbarCount').textContent =
    '显示 ' + data.length + ' / ' + allAppData.length + ' 个应用';

  // Dispose old charts
  disposeCardCharts();

  if (data.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128269;</div><div class="empty-text">暂无匹配的应用数据</div></div>';
    return;
  }

  var html = '';
  data.forEach(function(app, idx) {
    var badgeClass = app.qualified ? 'pass' : 'fail';
    var badgeText = app.qualified ? '达标' : '未达标';

    var mauClass = app.maxMau >= 400 ? 'v-green' : 'v-red';
    var curMauClass = app.currentMau >= 400 ? 'v-green' : (app.currentMau >= 300 ? 'v-yellow' : 'v-red');

    var scoreOk = app.score >= 3;
    var countOk = app.scoreCount >= 10;

    var increaseHtml = '';
    if (app.yesterdayIncrease > 0) {
      increaseHtml = '<span class="increase-tag pos">+' + app.yesterdayIncrease + '</span>';
    } else if (app.yesterdayIncrease < 0) {
      increaseHtml = '<span class="increase-tag neg">' + app.yesterdayIncrease + '</span>';
    } else {
      increaseHtml = '<span class="increase-tag zero">0</span>';
    }

    var cardId = 'card-chart-' + idx;

    html += '<div class="app-card">' +
      '<div class="card-info">' +
        '<div class="card-header">' +
          '<div class="card-app-name" title="' + escapeHtml(app.appName) + '">' + escapeHtml(app.appName) + '</div>' +
          '<span class="card-badge ' + badgeClass + '">' + badgeText + '</span>' +
        '</div>' +
        '<div class="card-metrics">' +
          '<div class="metric-row">' +
            '<span class="metric-label">当月月活</span>' +
            '<span class="metric-value ' + curMauClass + '">' + app.currentMau + '</span>' +
          '</div>' +
          '<div class="metric-row">' +
            '<span class="metric-label">最高月活</span>' +
            '<span class="metric-value ' + mauClass + '">' + app.maxMau + '</span>' +
          '</div>' +
          '<div class="metric-row">' +
            '<span class="metric-label">月末评分</span>' +
            '<span class="metric-value ' + (scoreOk ? 'v-green' : 'v-red') + '">' + app.score + '</span>' +
          '</div>' +
          '<div class="metric-row">' +
            '<span class="metric-label">评分个数</span>' +
            '<span class="metric-value ' + (countOk ? 'v-green' : 'v-red') + '">' + app.scoreCount + '</span>' +
          '</div>' +
          '<div class="metric-row">' +
            '<span class="metric-label">昨日新增</span>' +
            '<span class="card-increase">' + increaseHtml + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-qualified-detail">' +
          '<span class="qual-chip ' + (app.maxMau >= 400 ? 'ok' : 'no') + '">月活' + (app.maxMau >= 400 ? '&#10003;' : '&#10007;') + '</span>' +
          '<span class="qual-chip ' + (scoreOk ? 'ok' : 'no') + '">评分' + (scoreOk ? '&#10003;' : '&#10007;') + '</span>' +
          '<span class="qual-chip ' + (countOk ? 'ok' : 'no') + '">数量' + (countOk ? '&#10003;' : '&#10007;') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="card-chart-area">' +
        '<div class="card-chart-title">月度月活趋势</div>' +
        '<div class="card-chart" id="' + cardId + '"></div>' +
      '</div>' +
    '</div>';
  });

  grid.innerHTML = html;

  // Initialize charts after DOM is ready
  requestAnimationFrame(function() {
    data.forEach(function(app, idx) {
      var cardId = 'card-chart-' + idx;
      initCardChart(cardId, app.appName);
    });
  });
}

// ===== Per-Card Chart =====
function initCardChart(domId, appName) {
  var dom = document.getElementById(domId);
  if (!dom) return;

  var monthlyData = perfDataCache[appName];
  if (!monthlyData || monthlyData.length === 0) {
    dom.className = 'card-chart-empty';
    dom.textContent = '暂无月度数据';
    return;
  }

  // Sort ascending by month
  var sorted = monthlyData.slice().sort(function(a, b) {
    return String(a.month).localeCompare(String(b.month));
  });

  // Take latest 6 months
  var display = sorted.slice(-6);

  var months = [];
  var mauValues = [];
  var ratingValues = [];

  display.forEach(function(item) {
    var m = String(item.month);
    // Format: "2025-05" -> "05月" or similar
    var parts = m.split('-');
    var label = parts.length >= 2 ? parts[1] + '月' : m;
    months.push(label);
    mauValues.push(parseInt(item.mau, 10) || 0);
    ratingValues.push(parseFloat(item.rating) || 0);
  });

  var myChart = echarts.init(dom);
  cardChartInstances[domId] = myChart;

  var isLight = isLightTheme;
  var lineStart = isLight ? '#6366f1' : '#818cf8';
  var lineEnd = isLight ? '#0891b2' : '#06b6d4';
  var areaStart = isLight ? 'rgba(99, 102, 241, 0.12)' : 'rgba(129, 140, 248, 0.18)';
  var areaEnd = isLight ? 'rgba(99, 102, 241, 0)' : 'rgba(129, 140, 248, 0)';
  var dotColor = isLight ? '#6366f1' : '#818cf8';
  var dotBorder = isLight ? '#ffffff' : '#0e1426';
  var tooltipBg = isLight ? 'rgba(255,255,255,0.98)' : 'rgba(14,20,38,0.96)';
  var tooltipBorder = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(99,102,241,0.2)';
  var tooltipText = isLight ? '#334155' : '#e2e8f0';
  var axisColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(148,163,184,0.08)';
  var labelColor = isLight ? '#94a3b8' : '#64748b';
  var markColor = isLight ? 'rgba(22,163,74,0.4)' : 'rgba(34,197,94,0.45)';
  var markLabel = isLight ? '#16a34a' : '#22c55e';
  var ratingBarColor = isLight ? 'rgba(99,102,241,0.35)' : 'rgba(129,140,248,0.35)';

  var option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      textStyle: { color: tooltipText, fontSize: 12 },
      formatter: function(params) {
        var tip = '<div style="font-weight:600;margin-bottom:4px">' + params[0].axisValue + '</div>';
        params.forEach(function(p) {
          var unit = p.seriesName === '月活' ? '' : ' 分';
          tip += '<div style="display:flex;align-items:center;gap:6px;margin:2px 0">' +
            '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + p.color + '"></span>' +
            p.seriesName + ': <b>' + p.value + unit + '</b></div>';
        });
        return tip;
      }
    },
    legend: {
      show: true,
      top: 0,
      right: 0,
      textStyle: { color: labelColor, fontSize: 10 },
      itemWidth: 12,
      itemHeight: 3,
      itemGap: 12
    },
    grid: { top: 28, right: 38, bottom: 18, left: 42, containLabel: false },
    xAxis: {
      type: 'category',
      data: months,
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: labelColor, fontSize: 10 },
      axisTick: { show: false }
    },
    yAxis: [
      {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: labelColor, fontSize: 10 },
        splitLine: { lineStyle: { color: axisColor } }
      },
      {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: labelColor, fontSize: 10 },
        splitLine: { show: false },
        min: 0,
        max: 5
      }
    ],
    series: [
      {
        name: '月活',
        type: 'line',
        yAxisIndex: 0,
        data: mauValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: {
          width: 2.5,
          color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [
            { offset: 0, color: lineStart },
            { offset: 1, color: lineEnd }
          ])
        },
        itemStyle: {
          color: dotColor,
          borderWidth: 2,
          borderColor: dotBorder
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: areaStart },
            { offset: 1, color: areaEnd }
          ])
        },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: markColor, type: 'dashed', width: 1 },
          label: { show: true, formatter: '400', color: markLabel, fontSize: 9, position: 'insideEndTop' },
          data: [{ yAxis: 400 }]
        }
      },
      {
        name: '评分',
        type: 'bar',
        yAxisIndex: 1,
        data: ratingValues,
        barWidth: 10,
        barGap: '30%',
        itemStyle: {
          color: ratingBarColor,
          borderRadius: [3, 3, 0, 0]
        }
      }
    ]
  };

  myChart.setOption(option);
}

// ===== Utilities =====
function escapeHtml(text) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(text));
  return d.innerHTML;
}

// ===== Window Resize =====
window.addEventListener('resize', function() {
  Object.keys(cardChartInstances).forEach(function(key) {
    if (cardChartInstances[key]) cardChartInstances[key].resize();
  });
});

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
  initTheme();
  systemThemeListener();

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('nameFilter').addEventListener('input', function() { renderCards(); });
  document.getElementById('statusFilter').addEventListener('change', function() { renderCards(); });

  renderStats();
});
