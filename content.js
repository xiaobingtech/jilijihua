(function () {
  'use strict';

  console.log('[MAU插件] content.js 已加载 (isolated world)');

  var mauDataMap = {};
  var maxMauMap = {};
  var processedRows = new WeakSet();
  var fullAppList = [];
  var DELEGATE_EVENT = 'MAU_EXTENSION_DELEGATE_DATA';
  var STATS_DELEGATE_EVENT = 'MAU_EXTENSION_STATS_DELEGATE_DATA';
  var AUTO_DELEGATE_EVENT = 'MAU_EXTENSION_AUTO_DELEGATE_DATA';
  var STORAGE_KEY = 'MAU_PLUGIN_DATA';

  var previousData = {};
  var todayKey = '';
  var isFirstDayOfMonth = false;

  function getTodayKey() {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    return year + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
  }

  function isFirstDayOfCurrentMonth() {
    var now = new Date();
    return now.getDate() === 1;
  }

  function loadStoredData() {
    return new Promise(function(resolve, reject) {
      chrome.storage.local.get(STORAGE_KEY, function(result) {
        if (chrome.runtime.lastError) {
          console.error('[MAU插件] 加载存储失败:', chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        var rawData = result[STORAGE_KEY];
        var data = {};
        if (typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)) {
          data = rawData;
        } else if (typeof rawData === 'string') {
          try {
            data = JSON.parse(rawData);
            if (Array.isArray(data)) data = {};
          } catch (e) {
            console.error('[MAU插件] 解析存储数据失败:', e);
            data = {};
          }
        }
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          data = {};
          var obj = {};
          obj[STORAGE_KEY] = data;
          chrome.storage.local.set(obj);
        }
        console.log('[MAU插件] 从chrome.storage加载数据，keys:', Object.keys(data));
        resolve(data);
      });
    });
  }

  function saveStoredData(data) {
    var obj = {};
    obj[STORAGE_KEY] = data;
    console.log('[MAU插件] saveStoredData 被调用，数据大小:', JSON.stringify(data).length);
    chrome.storage.local.set(obj, function() {
      if (chrome.runtime.lastError) {
        console.error('[MAU插件] 保存存储失败:', chrome.runtime.lastError.message);
      } else {
        var keys = Object.keys(data);
        console.log('[MAU插件] 保存数据到chrome.storage成功，日期keys:', keys);
        showToast('数据保存完成');
      }
    });
  }

  function showToast(message) {
    var existing = document.getElementById('mau-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'mau-toast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px);
      background: linear-gradient(135deg, rgba(10, 89, 247, 0.95), rgba(8, 68, 193, 0.98));
      color: white;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      z-index: 99999;
      opacity: 0;
      transition: opacity 0.3s, transform 0.3s;
      pointer-events: none;
      box-shadow: 0 4px 20px rgba(10, 89, 247, 0.3);
      letter-spacing: 0.5px;
    `;
    document.body.appendChild(toast);

    setTimeout(function() {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    setTimeout(function() {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(function() {
        if (toast.parentNode) toast.remove();
      }, 300);
    }, 3000);
  }

  function getPreviousDayKey(today) {
    var parts = today.split('-');
    var date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    date.setDate(date.getDate() - 1);
    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    return year + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day);
  }

  function getAppTypeLabel(type) {
    var typeMap = {
      '1': '新应用',
      '2': '新应用',
      '3': '更新应用',
      '4': '新增应用'
    };
    return typeMap[String(type)] || '新应用';
  }

  function buildMauDataMap(appList) {
    mauDataMap = {};
    maxMauMap = {};
    appList.forEach(function(app) {
      var appName = app.appName;
      var appId = app.appId;
      if (app.performanceDatas && app.performanceDatas.length > 0) {
        var sortedAsc = app.performanceDatas.slice().sort(function(a, b) {
          var monthA = String(a.month || '');
          var monthB = String(b.month || '');
          return monthA.localeCompare(monthB);
        });

        var currentMau = sortedAsc[sortedAsc.length - 1].mau;

        var maxMau = 0;
        app.performanceDatas.forEach(function(perf) {
          if (perf.mau) {
            var num = parseInt(perf.mau, 10);
            if (num > maxMau) {
              maxMau = num;
            }
          }
        });

        var lastMonthScore = '0';
        var lastMonthScoreCount = '0';
        if (sortedAsc.length > 0) {
          lastMonthScore = sortedAsc[0].rating || '0';
          lastMonthScoreCount = sortedAsc[0].ratingCount || '0';
        }

        var increase = 0;
        if (previousData[appName]) {
          var prevMau = parseInt(previousData[appName].currentMau, 10) || 0;
          var currMau = parseInt(currentMau, 10) || 0;
          increase = currMau - prevMau;
        }

        mauDataMap[appName] = {
          mau: currentMau,
          appId: appId,
          maxMau: maxMau.toString(),
          score: lastMonthScore,
          scoreCount: lastMonthScoreCount,
          increase: increase
        };

        maxMauMap[appName] = maxMau.toString();
      }
    });
  }

  function processApiData(data, isAutoRequest, isStatsRequest) {
    if (!data || !data.appPerfDataList) {
      console.log('[MAU插件] processApiData: 数据无效或无appPerfDataList，直接返回');
      return;
    }
    console.log('[MAU插件] 处理 delegate 数据，共', data.appPerfDataList.length, '条, isAutoRequest:', isAutoRequest, ', isStatsRequest:', isStatsRequest);

    todayKey = getTodayKey();
    isFirstDayOfMonth = isFirstDayOfCurrentMonth();

    if (isStatsRequest) {
      console.log('[MAU插件] 统计请求模式');
      fullAppList = data.appPerfDataList;
      return;
    }

    if (isAutoRequest) {
      console.log('[MAU插件] 自动请求模式，只保存数据，不修改页面');
      fullAppList = data.appPerfDataList;
      saveAutoRequestData(data.appPerfDataList);
      return;
    }

    console.log('[MAU插件] 分页请求模式，更新表格显示');
    buildMauDataMap(data.appPerfDataList);
    scheduleTableUpdate();
  }

  function saveAutoRequestData(appList) {
    loadStoredData().then(function(storedData) {
      var todayAppData = {};
      appList.forEach(function(app) {
        var appName = app.appName;
        var maxMau = 0;
        var lastMonthScore = '0';
        var lastMonthScoreCount = '0';

        if (app.performanceDatas && app.performanceDatas.length > 0) {
          var sorted = app.performanceDatas.slice().sort(function(a, b) {
            var monthA = String(a.month || '');
            var monthB = String(b.month || '');
            return monthA.localeCompare(monthB);
          });

          var currentMau = sorted[sorted.length - 1].mau || '0';

          app.performanceDatas.forEach(function(perf) {
            if (perf.mau) {
              var num = parseInt(perf.mau, 10);
              if (num > maxMau) {
                maxMau = num;
              }
            }
          });

          if (sorted.length > 0) {
            lastMonthScore = sorted[0].rating || '0';
            lastMonthScoreCount = sorted[0].ratingCount || '0';
          }

          todayAppData[appName] = {
            currentMau: currentMau,
            maxMau: maxMau.toString(),
            score: lastMonthScore,
            scoreCount: lastMonthScoreCount
          };
        } else {
          todayAppData[appName] = {
            currentMau: '0',
            maxMau: '0',
            score: '0',
            scoreCount: '0'
          };
        }
      });

      storedData[todayKey] = todayAppData;
      saveStoredData(storedData);
      console.log('[MAU插件] 自动请求数据已保存到:', todayKey, ', 共', Object.keys(todayAppData).length, '个应用');

      if (!isFirstDayOfMonth) {
        var prevKey = getPreviousDayKey(todayKey);
        if (storedData[prevKey]) {
          previousData = storedData[prevKey];
          console.log('[MAU插件] 找到前一天数据:', prevKey);
        } else {
          var keys = Object.keys(storedData).sort();
          var found = false;
          for (var i = keys.length - 1; i >= 0; i--) {
            if (keys[i] < todayKey) {
              previousData = storedData[keys[i]];
              console.log('[MAU插件] 使用最近的历史数据:', keys[i]);
              found = true;
              break;
            }
          }
          if (!found) {
            previousData = {};
            console.log('[MAU插件] 没有历史数据，不做对比');
          }
        }
      } else {
        console.log('[MAU插件] 当月1号，不做对比');
        previousData = {};
      }

      buildMauDataMap(appList);
      processedRows = new WeakSet();
      scheduleTableUpdate();
    });
  }

  var updateTimers = [];
  function scheduleTableUpdate() {
    updateTimers.forEach(function (t) { clearTimeout(t); });
    updateTimers = [];
    updateTimers.push(setTimeout(updateTable, 200));
    updateTimers.push(setTimeout(updateTable, 600));
    updateTimers.push(setTimeout(updateTable, 1500));
  }

  function getColumnIndex(container, columnName) {
    var thead = container.querySelector('table thead');
    if (!thead) return -1;

    var thElements = thead.querySelectorAll('th');
    for (var i = 0; i < thElements.length; i++) {
      var text = thElements[i].textContent.trim();
      if (text === columnName) {
        return i;
      }
    }
    return -1;
  }

  function updateHeader(container) {
    var thead = container.querySelector('table thead');
    if (!thead) return;

    var thElements = thead.querySelectorAll('th');
    thElements.forEach(function (th) {
      var text = th.textContent.trim();
      if (text === '功能完备情况') {
        th.textContent = '本月有效月活';
        console.log('[MAU插件] 表头已修改：功能完备情况 -> 本月有效月活');
      } else if (text === '账号服务') {
        th.textContent = '最高月活';
        console.log('[MAU插件] 表头已修改：账号服务 -> 最高月活');
      }
    });
  }

  function updateTable() {
    var containers = document.querySelectorAll('.incentive-query-container');
    if (containers.length === 0) {
      return;
    }

    containers.forEach(function (container) {
      var mauColumnIndex = getColumnIndex(container, '功能完备情况');
      var maxMauColumnIndex = getColumnIndex(container, '账号服务');

      if (mauColumnIndex < 0) {
        mauColumnIndex = getColumnIndex(container, '本月有效月活');
      }
      if (maxMauColumnIndex < 0) {
        maxMauColumnIndex = getColumnIndex(container, '最高月活');
      }

      updateHeader(container);

      var tbody = container.querySelector('table tbody');
      if (!tbody) {
        return;
      }

      var rows = tbody.querySelectorAll('tr:not(.nulldata)');
      rows.forEach(function (row) {
        if (processedRows.has(row)) {
          return;
        }
        processedRows.add(row);

        var cells = row.querySelectorAll('td');
        if (cells.length < 2 || mauColumnIndex < 0 || maxMauColumnIndex < 0) {
          return;
        }

        var appNameCell = cells[0];
        var mauCell = cells[mauColumnIndex];
        var maxMauCell = cells[maxMauColumnIndex];

        if (!mauCell || !maxMauCell) {
          return;
        }

        var appName = appNameCell.textContent.trim();
        var mauInfo = mauDataMap[appName];
        var maxMau = maxMauMap[appName];

        if (mauInfo) {
          var existingMau = mauCell.querySelector('.mau-extension-data');
          if (!existingMau) {
            console.log('[MAU插件] 更新表格:', appName, '-> 本月MAU:', mauInfo.mau, ', 最高MAU:', mauInfo.maxMau, ', 增量:', mauInfo.increase);

            var mauNum = parseInt(mauInfo.mau, 10) || 0;
            var isGreen = mauNum >= 400;

            var displayText = mauInfo.mau;
            if (!isFirstDayOfMonth && mauInfo.increase !== 0) {
              var incStr = mauInfo.increase > 0 ? '+' + mauInfo.increase : mauInfo.increase.toString();
              displayText = mauInfo.mau + ' <span style="font-size:11px;color:#666;">(' + incStr + ')</span>';
            }

            var mauSpan = document.createElement('span');
            mauSpan.className = 'mau-extension-data';
            mauSpan.innerHTML = displayText;
            mauSpan.style.cssText =
              'display:inline-block;padding:4px 10px;border-radius:12px;font-size:12px;line-height:16px;font-weight:500;' +
              (isGreen ? 'background-color:#e8f5e9;color:#2e7d32;' : 'background-color:#ffebee;color:#c62828;');

            mauCell.innerHTML = '';
            mauCell.appendChild(mauSpan);
          }
        }

        if (maxMau !== undefined) {
          var existingMaxMau = maxMauCell.querySelector('.maxmau-extension-data');
          if (!existingMaxMau) {
            console.log('[MAU插件] 更新表格:', appName, '-> 最高月活:', maxMau);
            var maxMauNum = parseInt(maxMau, 10);
            var isMaxGreen = maxMauNum >= 400;

            var maxMauSpan = document.createElement('span');
            maxMauSpan.className = 'maxmau-extension-data';
            maxMauSpan.textContent = maxMau;
            maxMauSpan.style.cssText =
              'display:inline-block;padding:4px 10px;border-radius:12px;font-size:12px;line-height:16px;font-weight:500;' +
              (isMaxGreen ? 'background-color:#e8f5e9;color:#2e7d32;' : 'background-color:#ffebee;color:#c62828;');

            maxMauCell.innerHTML = '';
            maxMauCell.appendChild(maxMauSpan);
          }
        }
      });
    });
  }

  function observeDOM() {
    var observer = new MutationObserver(function () {
      processedRows = new WeakSet();
      updateTable();
    });

    var startObserve = function () {
      var target = document.querySelector('.incentive-query-container');
      if (target) {
        console.log('[MAU插件] 找到 incentive-query-container，开始监听DOM变化');
        observer.observe(target, { childList: true, subtree: true });
      } else {
        setTimeout(startObserve, 500);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserve);
    } else {
      startObserve();
    }
  }

  document.addEventListener(DELEGATE_EVENT, function (event) {
    console.log('[MAU插件] 收到 delegate 事件');
    processApiData(event.detail, false, false);
  });

  document.addEventListener(STATS_DELEGATE_EVENT, function (event) {
    console.log('[MAU插件] 收到统计 delegate 事件');
    processApiData(event.detail, false, true);
  });

  document.addEventListener(AUTO_DELEGATE_EVENT, function (event) {
    console.log('[MAU插件] 收到自动 delegate 事件');
    processApiData(event.detail, true, false);
  });

  function createFloatButton() {
    var button = document.createElement('div');
    button.id = 'mau-float-button';
    button.style.cssText = `
      position: fixed;
      bottom: 30px;
      left: 30px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background-image: url('${chrome.runtime.getURL('icons/icon.png')}');
      background-size: cover;
      background-position: center;
      opacity: 0.6;
      cursor: pointer;
      z-index: 9999;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      transition: opacity 0.3s ease;
    `;

    button.addEventListener('mouseenter', function () {
      button.style.opacity = '1';
    });

    button.addEventListener('mouseleave', function () {
      button.style.opacity = '0.6';
    });

    button.addEventListener('click', function () {
      window.open('http://47.116.201.205/gongsi/zhenlv/web/', '_blank');
    });

    document.body.appendChild(button);
  }

  function createStatsButton() {
    var button = document.createElement('button');
    button.id = 'mau-stats-button';
    button.textContent = '进入统计页面';
    button.style.cssText = `
      position: fixed;
      top: 90px;
      right: 30px;
      padding: 8px 20px;
      background-color: #0a59f7;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      z-index: 9999;
      box-shadow: 0 2px 8px rgba(10, 89, 247, 0.3);
      transition: background-color 0.3s ease;
    `;

    button.addEventListener('mouseenter', function () {
      button.style.backgroundColor = '#0844c1';
    });

    button.addEventListener('mouseleave', function () {
      button.style.backgroundColor = '#0a59f7';
    });

    button.addEventListener('click', function () {
      console.log('[激励计划] content.js 点击统计按钮');
      try {
        var todayData = {};
        var perfData = {};
        fullAppList.forEach(function (app) {
          var appName = app.appName;
          var maxMau = '0';
          var score = '0';
          var scoreCount = '0';
          var currentMau = '0';
          var monthlyData = [];

          if (app.performanceDatas && app.performanceDatas.length > 0) {
            var sorted = app.performanceDatas.slice().sort(function (a, b) {
              var monthA = String(a.month || '');
              var monthB = String(b.month || '');
              return monthA.localeCompare(monthB);
            });

            currentMau = sorted[sorted.length - 1].mau || '0';

            var maxMauVal = 0;
            app.performanceDatas.forEach(function (perf) {
              if (perf.mau) {
                var num = parseInt(perf.mau, 10);
                if (num > maxMauVal) {
                  maxMauVal = num;
                }
              }
            });
            maxMau = maxMauVal.toString();

            if (sorted.length > 0) {
              score = sorted[0].rating || '0';
              scoreCount = sorted[0].ratingCount || '0';
            }

            monthlyData = sorted.map(function(p) {
              return {
                month: p.month || '',
                mau: p.mau || '0',
                rating: p.rating || '0',
                ratingCount: p.ratingCount || '0'
              };
            });
          }

          todayData[appName] = {
            currentMau: currentMau,
            maxMau: maxMau,
            score: score,
            scoreCount: scoreCount
          };
          perfData[appName] = monthlyData;
        });

        // Store performance data in chrome.storage for stats page
        chrome.storage.local.set({ 'MAU_PLUGIN_PERF_DATA': perfData }, function() {
          var date = new Date().toLocaleDateString('zh-CN');
          var dataStr = encodeURIComponent(JSON.stringify(todayData));
          var statsUrl = chrome.runtime.getURL('stats.html') + '?date=' + encodeURIComponent(date) + '&data=' + dataStr;

          console.log('[激励计划] 打开统计页面:', statsUrl);
          window.open(statsUrl, '_blank');
        });

      } catch (e) {
        console.error('[激励计划] 打开统计页面失败:', e.message);
      }
    });

    document.body.appendChild(button);
  }

  function triggerAutoRequest() {
    console.log('[MAU插件] 触发自动请求');
    try {
      document.dispatchEvent(new CustomEvent('MAU_EXTENSION_AUTO_REQUEST'));
      console.log('[MAU插件] 自动请求事件发送成功');
    } catch (e) {
      console.error('[MAU插件] 自动请求事件发送失败:', e.message);
    }
  }

  function initPreviousData() {
    todayKey = getTodayKey();
    isFirstDayOfMonth = isFirstDayOfCurrentMonth();

    if (isFirstDayOfMonth) {
      previousData = {};
      return;
    }

    loadStoredData().then(function(storedData) {
      var prevKey = getPreviousDayKey(todayKey);
      if (storedData[prevKey]) {
        previousData = storedData[prevKey];
        console.log('[MAU插件] 初始化加载前一天数据:', prevKey);
      } else {
        var keys = Object.keys(storedData).sort();
        for (var i = keys.length - 1; i >= 0; i--) {
          if (keys[i] < todayKey) {
            previousData = storedData[keys[i]];
            console.log('[MAU插件] 初始化加载最近历史数据:', keys[i]);
            break;
          }
        }
      }
    });
  }

  observeDOM();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      createFloatButton();
      createStatsButton();
      initPreviousData();
      setTimeout(triggerAutoRequest, 2000);
    });
  } else {
    createFloatButton();
    createStatsButton();
    initPreviousData();
    setTimeout(triggerAutoRequest, 2000);
  }
})();
