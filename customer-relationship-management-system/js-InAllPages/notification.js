// Render the notification bell and its dropdown panel.
(function () {
  'use strict';

  // Configure the feed URL, refresh interval, and icon path prefix.
  var NOTIFICATIONS_URL = '';
  var REFRESH_MS = 30000;
  var ICON_FOLDER = '';

  var MIN = 60 * 1000;

  // Map notification types to their icons.
  var ICON_FILES = {
    lead:     'icons/leads-and-deals-icon.svg',
    deal:     'icons/leads-and-deals-icon.svg',
    ticket:   'icons/tickets-icon.svg',
    activity: 'icons/activity-icon.svg',
    customer: 'icons/contacts-icon.svg'
  };
  var DEFAULT_ICON = 'dashboard icon.svg';

  var items = [];
  var panel = null;
  var nextId = 1000;

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function iconSrc(type) {
    return encodeURI(ICON_FOLDER + (ICON_FILES[type] || DEFAULT_ICON));
  }

  function timeAgo(item) {
    if (item.time) return item.time;
    var t = new Date(item.createdAt).getTime();
    if (isNaN(t)) return '';
    var mins = Math.floor((Date.now() - t) / MIN);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    var days = Math.floor(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  function unreadCount() {
    return items.filter(function (n) { return !n.read; }).length;
  }

  // Update the unread indicator on the bell.
  function updateDot() {
    var dot = document.getElementById('notificationDot');
    if (!dot) return;
    dot.style.display = '';
    dot.classList.toggle('active', unreadCount() > 0);
  }

  // Build the notification panel once.
  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'notif-panel';
    panel.id = 'notificationPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.innerHTML =
      '<div class="notif-header">' +
        '<h6 class="notif-title">Notifications <span class="notif-count" id="notifCount"></span></h6>' +
        '<button type="button" class="notif-mark-all" id="notifMarkAll">Mark all as read</button>' +
      '</div>' +
      '<ul class="notif-list" id="notifList"></ul>';
    document.body.appendChild(panel);

    panel.querySelector('#notifMarkAll').addEventListener('click', markAllRead);
    panel.querySelector('#notifList').addEventListener('click', onItemClick);
  }

  function render() {
    if (!panel) return;
    var list = panel.querySelector('#notifList');
    var count = unreadCount();
    panel.querySelector('#notifCount').textContent = count ? '(' + count + ' new)' : '';
    panel.querySelector('#notifMarkAll').style.visibility = count ? 'visible' : 'hidden';

    if (!items.length) {
      list.innerHTML = '<li class="notif-empty">No notifications</li>';
      return;
    }
    list.innerHTML = items.map(function (n) {
      return '<li class="notif-item' + (n.read ? '' : ' unread') + '" data-id="' + esc(n.id) + '">' +
        '<div class="notif-icon"><img src="' + esc(iconSrc(n.type)) + '" alt=""></div>' +
        '<div class="notif-body">' +
          '<p class="notif-item-title">' + esc(n.title) + '</p>' +
          '<p class="notif-item-msg">' + esc(n.message) + '</p>' +
          '<span class="notif-time">' + esc(timeAgo(n)) + '</span>' +
        '</div>' +
      '</li>';
    }).join('');
  }

  function position() {
    var bell = document.getElementById('notificationBell');
    if (!bell || !panel) return;
    var r = bell.getBoundingClientRect();
    panel.style.top = (r.bottom + 10) + 'px';
    var right = Math.max(12, window.innerWidth - r.right - 8);
    panel.style.right = right + 'px';
  }

  function isOpen() { return panel && panel.classList.contains('open'); }

  function open() {
    if (!panel) buildPanel();
    render();
    position();
    panel.classList.add('open');
    var bell = document.getElementById('notificationBell');
    if (bell) bell.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!panel) return;
    panel.classList.remove('open');
    var bell = document.getElementById('notificationBell');
    if (bell) bell.setAttribute('aria-expanded', 'false');
  }

  // Update notification state in the current page.
  function markRead(id) {
    items.forEach(function (n) { if (String(n.id) === String(id)) n.read = true; });
    render();
    updateDot();
  }

  function markAllRead() {
    items.forEach(function (n) { n.read = true; });
    render();
    updateDot();
  }

  function openPage(page) {
    if (!page || typeof window.loadPage !== 'function') return;
    var link = document.querySelector('.sidebar-nav a[onclick*="' + page + '"]');
    try { window.loadPage(page, link); } catch (err) { console.warn('Could not open', page, err); }
  }

  function onItemClick(e) {
    var li = e.target.closest('.notif-item');
    if (!li) return;
    var id = li.getAttribute('data-id');
    var item = items.filter(function (n) { return String(n.id) === String(id); })[0];
    markRead(id);
    close();
    if (item) openPage(item.page);
  }

  function normalize(n) {
    return {
      id: n.id !== undefined ? n.id : nextId++,
      type: n.type || 'bell',
      title: n.title || 'New notification',
      message: n.message || '',
      createdAt: n.createdAt || Date.now(),
      time: n.time,
      read: !!n.read,
      page: n.page
    };
  }

  function add(n) {
    items.unshift(normalize(n || {}));
    render();
    updateDot();
  }

  function setAll(list) {
    items = (list || []).map(normalize);
    render();
    updateDot();
  }

  // Load notifications when a feed URL is configured.
  function loadFromServer() {
    if (!NOTIFICATIONS_URL) return;
    fetch(NOTIFICATIONS_URL, { credentials: 'same-origin' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        setAll(Array.isArray(data) ? data : (data && data.notifications) || []);
      })
      .catch(function (err) { console.warn('Could not load notifications', err); });
  }

  // Expose notification controls for other scripts.
  window.crmNotifications = {
    add: add, setAll: setAll, markAllRead: markAllRead, open: open, close: close, reload: loadFromServer
  };

  // Handle bell clicks and dismiss the panel.
  document.addEventListener('click', function (e) {
    if (e.target.closest('#notificationBell')) {
      e.preventDefault();
      if (isOpen()) close(); else open();
      return;
    }
    if (isOpen() && !e.target.closest('#notificationPanel')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) close();
  });

  window.addEventListener('resize', function () { if (isOpen()) position(); });

  function init() {
    updateDot();
    loadFromServer();
    if (NOTIFICATIONS_URL) setInterval(loadFromServer, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();