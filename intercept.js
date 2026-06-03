(function () {
  'use strict';

  console.log('[MAU插件] intercept.js 已加载 (MAIN world)');

  var DELEGATE_EVENT = 'MAU_EXTENSION_DELEGATE_DATA';
  var STATS_DELEGATE_EVENT = 'MAU_EXTENSION_STATS_DELEGATE_DATA';

  function parseNestedJson(text) {
    try {
      var data = JSON.parse(text);
      if (data.resJson) {
        console.log('[MAU插件] 发现 resJson 字段，尝试解析');
        data = JSON.parse(data.resJson);
      }
      if (data.result && data.result.resultString) {
        console.log('[MAU插件] 发现 result.resultString 字段，尝试解析');
        data = JSON.parse(data.result.resultString);
      }
      if (data.result && typeof data.result === 'string') {
        console.log('[MAU插件] result 是字符串，尝试解析');
        data = JSON.parse(data.result);
      }
      return data;
    } catch (e) {
      console.error('[MAU插件] parseNestedJson 异常:', e.message);
      return null;
    }
  }

  function processResponse(responseText, eventType) {
    eventType = eventType || DELEGATE_EVENT;
    console.log('[MAU插件] processResponse 被调用, responseText 长度:', responseText ? responseText.length : 0, '事件类型:', eventType);
    try {
      var data = parseNestedJson(responseText);
      if (!data) {
        console.log('[MAU插件] 解析失败');
        return;
      }
      
      console.log('[MAU插件] 解析后数据 keys:', Object.keys(data).slice(0, 5));
      console.log('[MAU插件] 有 appPerfDataList:', !!data.appPerfDataList);
      
      if (data && data.appPerfDataList) {
        console.log('[MAU插件] 拦截到 delegate 数据，appPerfDataList 数量:', data.appPerfDataList.length);
        document.dispatchEvent(new CustomEvent(eventType, {
          detail: data
        }));
      }
    } catch (e) {
      console.error('[MAU插件] processResponse 异常:', e.message);
    }
  }

  var lastDelegateRequest = null;

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__url = url;
    this.__method = method;
    this.__requestHeaders = {};
    return _open.apply(this, arguments);
  };

  var _setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (this.__requestHeaders) {
      this.__requestHeaders[header] = value;
    }
    return _setRequestHeader.apply(this, arguments);
  };

  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    if (xhr.__url && xhr.__url.indexOf('/codeserver/Common/v1/delegate') !== -1) {
      console.log('[MAU插件] delegate XHR 拦截成功:', xhr.__url);
      
      lastDelegateRequest = {
        url: xhr.__url,
        method: xhr.__method,
        body: body,
        headers: xhr.__requestHeaders || {}
      };
      console.log('[MAU插件] 保存 delegate 请求');

      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 4) {
          processResponse(xhr.responseText, DELEGATE_EVENT);
        }
      });
    }
    return _send.apply(this, arguments);
  };

  window.sendDelegateRequest = function (pageSize, isAutoRequest) {
    pageSize = pageSize || 300;
    console.log('[MAU插件] 发送统计请求，pageSize:', pageSize, ', isAutoRequest:', isAutoRequest);
    
    if (!lastDelegateRequest) {
      console.log('[MAU插件] 没有保存的请求，无法获取 headers');
      return;
    }
    
    var url = lastDelegateRequest.url;
    
    var requestData = {
      svc: 'partnerActivityService/v1/developer/queryDeveloperRewardAppList',
      reqType: 1,
      reqJson: JSON.stringify({
        current: 1,
        pageSize: pageSize
      })
    };
    
    console.log('[MAU插件] 请求体:', JSON.stringify(requestData));
    
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;
      
      if (lastDelegateRequest.headers) {
        for (var header in lastDelegateRequest.headers) {
          xhr.setRequestHeader(header, lastDelegateRequest.headers[header]);
          console.log('[MAU插件] 设置 header:', header);
        }
      }
      
      if (!lastDelegateRequest.headers || !lastDelegateRequest.headers['Content-Type']) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      
      xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
          console.log('[MAU插件] 自定义请求返回状态:', xhr.status);
          processResponse(xhr.responseText, isAutoRequest ? AUTO_DELEGATE_EVENT : STATS_DELEGATE_EVENT);
        }
      };
      
      xhr.send(JSON.stringify(requestData));
      
    } catch (e) {
      console.error('[MAU插件] 发送请求失败:', e.message);
    }
  };

  var AUTO_DELEGATE_EVENT = 'MAU_EXTENSION_AUTO_DELEGATE_DATA';

  document.addEventListener('MAU_EXTENSION_STATS_REQUEST', function (event) {
    console.log('[MAU插件] 收到统计请求事件');
    var pageSize = event.detail && event.detail.pageSize || 300;
    console.log('[MAU插件] 事件携带的 pageSize:', pageSize);
    window.sendDelegateRequest(pageSize, false);
  });

  document.addEventListener('MAU_EXTENSION_AUTO_REQUEST', function (event) {
    console.log('[MAU插件] 收到自动请求事件');
    window.sendDelegateRequest(300, true);
  });
})();