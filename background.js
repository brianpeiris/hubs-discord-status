'use strict';

class DiscordClient {
  constructor() {
    this._retryTimer = null;
    this._heartbeatTimer = null;
    this._retryDelay = 500;
    this._ws = null;
    this._status = null;
    this.token = null;
  }
  setStatus(status) {
    if (this._status === status) return;
    if (!this.token) return;
    clearTimeout(this._retryTimer);
    if (this._ws && this._ws.readyState !== WebSocket.CLOSED) {
      if (this._ws.readyState === WebSocket.OPEN) {
        this._send(this._getOpStatusUpdatePayload(status));
        this._status = status;
      } else {
        if (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.CLOSING) {
          this._retryTimer = setTimeout(() => {
            return this.setStatus(status);
          }, this._retryDelay);
        }
      }
    } else {
      this._ws = new WebSocket("wss://gateway.discord.gg/?v=6&encoding=json");
      this._lastSeq = null;
      this._ws.onopen = () => {
        this._send(this._getOpIdentifyPayload(status));
        this._status = status;
      };
      this._ws.onmessage = event => {
        return this._messageHandler(JSON.parse(event.data));
      };
      this._ws.onerror = event => {
        return console.log("discord socket error", event);
      };
      this._ws.onclose = event => {
        clearInterval(this._heartbeatTimer);
        console.log(
          "connection closed\n - code: " + event.code + 
          "\n - reason: " + event.reason + 
          "\n - wasClean: " + event.wasClean
        );
      };
    }
  }
  _send(data) {
    this._ws.send(JSON.stringify(data));
  }
  _sendHeartbeat() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._send(this._getOpHeartbeatPayload());
    }
  }
  _messageHandler(msg) {
    this._lastSeq = msg.s;
    switch(msg.op) {
      case 1:
        this._sendHeartbeat();
        break;
      case 10:
        clearInterval(this._heartbeatTimer);
        this._heartbeatTimer = setInterval(this._sendHeartbeat.bind(this), msg.d.heartbeat_interval);
        if (!this._status) {
          this._send(this._getOpStatusUpdatePayload(this._status));
        }
    }
  }
  _getOpHeartbeatPayload() {
    return {
      op : 1,
      d : this._lastSeq
    };
  }
  _getStatusUpdatePayload(status) {
    return {
      game : null === status ? null : {
        name : status,
        details: "hubs.mozilla.com",
        application_id: "509129921826914304",
        assets: {
          large_image:  "568373390222688257"
        },
        type : 0
      },
      status : "online",
      since : null,
      afk : false
    };
  }
  _getOpIdentifyPayload(status) {
    return {
      op : 2,
      d : {
        token : this.token,
        properties : {
          $os : navigator.platform,
          $browser : "Firefox",
          $device : "hubs-discord-status"
        },
        compress : false,
        large_threshold : 50,
        presence : this._getStatusUpdatePayload(status)
      }
    };
  }
  _getOpStatusUpdatePayload(status) {
    return {
      op : 3,
      d : this._getStatusUpdatePayload(status)
    };
  }
}

const discordClient = new DiscordClient();

let lastTokenCheck = Date.now();
const tokenCheckInterval = 1000 * 60 * 15;
function setTokenFromTab(tab) {
  if (discordClient.token && (Date.now() - lastTokenCheck) < tokenCheckInterval) return;
  lastTokenCheck = Date.now();
  chrome.tabs.executeScript(tab.id, {
    code: "localStorage.getItem('token');"
  }, storedToken => {
    if (storedToken && storedToken[0]) {
      discordClient.token = JSON.parse(storedToken);
    }
  })
}

const tabUrls = {};
browser.tabs.query({}).then(tabs => {
  for (const tab in tabs) {
    if (!tab.url) continue;
    tabUrls[tab.id] = tab.url;
    const url = new URL(tab.url);
    if (url.hostname === 'discordapp.com') {
      setTokenFromTab(tab);
    }
  }
  updateStatus();
});
function isPlaying() {
  return Object.values(tabUrls)
    .map(url => new URL(url).hostname)
    .some(hostname => hostname === 'hubs.mozilla.com');
}
function updateStatus() {
  discordClient.setStatus(isPlaying() ? 'Hubs by Mozilla' : null);
}
function onTab(tab) {
  tabUrls[tab.id] = tab.url;
  const currHostname = new URL(tab.url).hostname;

  if (currHostname === 'discordapp.com') {
    setTokenFromTab(tab);
  }

  updateStatus();
}
function onTabRemoved(id) {
  if (!tabUrls[id]) return;
  delete tabUrls[id];
  updateStatus();
}

browser.tabs.onCreated.addListener(onTab);
browser.tabs.onUpdated.addListener(id => browser.tabs.get(id).then(onTab));
browser.tabs.onReplaced.addListener((addedId, removedId) => {
  browser.tabs.get(addedId).then(onTab);
  onTabRemoved(removedId);
});
browser.tabs.onRemoved.addListener(onTabRemoved);
