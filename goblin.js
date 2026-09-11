(function () {
    'use strict';

    var FEED_URL = 'https://oper.ru/video.xml';
    var CACHE_TTL = 30 * 60 * 1000;
    var PAGE_SIZE = 30;
    var pluginReady = 'plugin_goblin_oper_' + Lampa.Utils.uid(4);

    /* ── Кэш ──────────────────────────────────── */
    var cache = { data: null, time: 0 };
    function getCache() {
        if (cache.data && (Date.now() - cache.time) < CACHE_TTL) return cache.data;
        return null;
    }
    function setCache(d) { cache.data = d; cache.time = Date.now(); }

    /* ── Сеть ─────────────────────────────────── */
    function fetchFeed(onOk, onErr) {
        var cached = getCache();
        if (cached) { onOk(cached); return; }

        var net = new Lampa.Reguest();
        net.timeout(20000);
        net.native(FEED_URL, function (data) {
            try {
                var videos = parseXML(data);
                setCache(videos);
                onOk(videos);
            } catch (e) {
                onErr('Парсинг: ' + e.message);
            }
        }, function () {
            // fallback на HTTP
            net.native('http://oper.ru/video.xml', function (data2) {
                try {
                    var videos = parseXML(data2);
                    setCache(videos);
                    onOk(videos);
                } catch (e) { onErr('Парсинг: ' + e.message); }
            }, function () { onErr('Сеть недоступна'); });
        });
    }

    /* ── Парсинг XML ──────────────────────────── */
    function parseXML(xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Невалидный XML');

        var items = doc.getElementsByTagName('item');
        var videos = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var title = txt(it, 'title');
            var link = txt(it, 'link');
            var pubDate = txt(it, 'pubDate');
            var enc = it.getElementsByTagName('enclosure')[0];
            var url = enc ? enc.getAttribute('url') : '';
            var dur = itNS(it, 'duration');
            var cat = itNS(it, 'subtitle') || 'Разное';
            var img = itNSAttr(it, 'image', 'href');

            if (!img) {
                var desc = txt(it, 'description') || '';
                var m = desc.match(/src="([^"]+)"/);
                if (m) img = m[1];
            }
            if (!url) continue;

            // Принудительно HTTPS
            if (url.indexOf('http://') === 0) url = 'https://' + url.slice(7);
            if (img && img.indexOf('http://') === 0) img = 'https://' + img.slice(7);

            videos.push({
                id: link, title: title, url: url, poster: img || '',
                category: cat, duration: dur || '', pubDate: pubDate || '',
                description: stripHtml(txt(it, 'description') || '').slice(0, 300)
            });
        }
        return videos;
    }

    function txt(p, t) {
        var e = p.getElementsByTagName(t)[0];
        return e ? (e.textContent || '').trim() : '';
    }
    function itNS(p, t) {
        var els = p.getElementsByTagName(t);
        for (var i = 0; i < els.length; i++) {
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 || els[i].localName === t)
                return (els[i].textContent || '').trim();
        }
        return '';
    }
    function itNSAttr(p, t, a) {
        var els = p.getElementsByTagName(t);
        for (var i = 0; i < els.length; i++) {
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 || els[i].localName === t)
                return els[i].getAttribute(a);
        }
        return '';
    }
    function stripHtml(h) {
        var d = document.createElement('div');
        d.innerHTML = h;
        return (d.textContent || d.innerText || '').trim();
    }
    function esc(s) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s || ''));
        return d.innerHTML;
    }

    /* ── Категории ───────────────────────────── */
    function getCategories(videos) {
        var seen = {}, cats = [];
        for (var i = 0; i < videos.length; i++) {
            var c = videos[i].category;
            if (!seen[c]) { seen[c] = true; cats.push(c); }
        }
        return cats;
    }

    /* ── CSS ─────────────────────────────────── */
    function injectCSS() {
        if (document.getElementById('goblin-css')) return;
        var s = document.createElement('style');
        s.id = 'goblin-css';
        s.textContent =
            '.goblin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;padding:16px;}' +
            '.goblin-card{cursor:pointer;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.05);}' +
            '.goblin-card .card__view{position:relative;aspect-ratio:16/9;background:rgba(0,0,0,.3);}' +
            '.goblin-card .card__img{width:100%;height:100%;object-fit:cover;}' +
            '.goblin-card .card__badge{position:absolute;top:6px;left:6px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:2px 8px;border-radius:4px;}' +
            '.goblin-card .card__play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);opacity:0;}' +
            '.goblin-card.focus .card__play{opacity:1;}' +
            '.goblin-card .card__title{padding:8px 10px 4px;font-size:13px;line-height:1.3;max-height:34px;overflow:hidden;}' +
            '.goblin-card .card__subtitle{padding:0 10px 10px;font-size:11px;opacity:.5;}' +
            '.goblin-more{text-align:center;padding:20px;font-size:14px;opacity:.7;}' +
            '.goblin-more.focus{opacity:1;}' +
            '.goblin-loading,.goblin-error{text-align:center;padding:60px 20px;opacity:.6;}';
        document.head.appendChild(s);
    }

    /* ── Компонент ───────────────────────────── */
    function GoblinComponent(activity) {
        var self = this;
        self.activity = activity;
        self.allVideos = [];
        self.filtered = [];
        self.currentCategory = 'Все';
        self.currentPage = 1;
        self.html = $('<div></div>');
        self.scroll = null;
        self.filter = null;

        self.render = function () { return self.html; };

        self.create = function () {
            var container = $(
                '<div class="goblin-wrap">' +
                '  <div class="goblin-filter"></div>' +
                '  <div class="goblin-content"></div>' +
                '</div>'
            );
            self.html.append(container);

            self.scroll = new Lampa.Scroll({ mask: true, over_mask: true });
            container.find('.goblin-content').append(self.scroll.render());
            self.filterWrap = container.find('.goblin-filter');

            self.showLoading();

            fetchFeed(function (videos) {
                self.allVideos = videos;
                self.buildFilter();
                self.applyFilter();
            }, function (err) {
                self.showError(err);
            });
        };

        self.buildFilter = function () {
            var cats = getCategories(self.allVideos);
            var fc = {};
            fc.category = {
                title: 'Категория',
                items: [{ title: 'Все' }].concat(cats.map(function (c) { return { title: c }; }))
            };

            self.filter = new Lampa.Filter({
                title: 'Тупичок Гоблина',
                results: self.allVideos.length,
                filter: fc,
                onSort: function () {},
                onFilter: function (state) {
                    self.currentCategory = state.category.selected.title || 'Все';
                    self.applyFilter();
                },
                onBack: function () { Lampa.Activity.backward(); }
            });

            self.filterWrap.append(self.filter.render());
        };

        self.applyFilter = function () {
            self.filtered = self.allVideos.filter(function (v) {
                return self.currentCategory === 'Все' || v.category === self.currentCategory;
            });
            self.currentPage = 1;
            self.renderPage();
        };

        self.renderPage = function () {
            self.scroll.clear();
            self.scroll.reset();

            var end = self.currentPage * PAGE_SIZE;
            var page = self.filtered.slice(0, end);
            var grid = $('<div class="goblin-grid"></div>');

            page.forEach(function (v) { grid.append(self.makeCard(v)); });
            self.scroll.append(grid);

            if (end < self.filtered.length) {
                var more = $('<div class="goblin-more selector"><span>Ещё (' + (self.filtered.length - end) + ')</span></div>');
                more.on('hover:enter', function () {
                    self.currentPage++;
                    self.renderPage();
                });
                self.scroll.append(more);
            }

            self.activity.toggle(false);
            Lampa.Controller.toggle('content');
        };

        self.makeCard = function (v) {
            var card = $(
                '<div class="card selector goblin-card">' +
                '  <div class="card__view">' +
                '    <img src="" alt="" class="card__img" />' +
                '    <div class="card__badge">' + esc(v.category) + '</div>' +
                '    <div class="card__play">' +
                '      <svg width="40" height="40" viewBox="0 0 40 40">' +
                '        <circle cx="20" cy="20" r="18" fill="rgba(0,0,0,0.6)" />' +
                '        <path d="M16 13 L28 20 L16 27 Z" fill="#fff" />' +
                '      </svg>' +
                '    </div>' +
                '  </div>' +
                '  <div class="card__title">' + esc(v.title) + '</div>' +
                '  <div class="card__subtitle">' + esc(v.duration) + '</div>' +
                '</div>'
            );

            if (v.poster) card.find('.card__img').attr('src', v.poster);
            else card.find('.card__img').hide();

            card.on('hover:enter', function () { self.playVideo(v); });
            return card;
        };

        self.playVideo = function (v) {
            Lampa.Player.play({ title: v.title, url: v.url });
            Lampa.Player.playlist([{ title: v.title, url: v.url }]);
            Lampa.Player.video({ id: v.id });
        };

        self.showLoading = function () {
            self.scroll.clear();
            self.scroll.append('<div class="goblin-loading"><div class="broadcast__scan"></div><div>Загрузка…</div></div>');
        };

        self.showError = function (msg) {
            self.scroll.clear();
            self.scroll.append(
                '<div class="goblin-error">' +
                '<div style="opacity:.7;margin-bottom:12px">Не удалось загрузить ленту</div>' +
                '<div style="opacity:.5;font-size:.9em">' + esc(msg) + '</div></div>'
            );
            Lampa.Controller.toggle('content');
        };

        self.start = function () {
            Lampa.Background.change('');
            Lampa.Controller.toggle('content');
        };
        self.pause = function () {};
        self.stop = function () {};
        self.destroy = function () {
            if (self.scroll) self.scroll.destroy();
            if (self.filter) self.filter.destroy();
            self.html.remove();
        };
    }

    /* ── Инициализация ───────────────────────── */
    function start() {
        if (window[pluginReady]) return;
        window[pluginReady] = true;

        injectCSS();
        Lampa.Component.add('goblin_oper', GoblinComponent);

        // Добавляем пункт меню — через прямой DOM (работает во всех версиях)
        var icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
            '<path d="M3 3 L12 3 L12 21 L3 21 Z"/>' +
            '<path d="M12 3 L21 3 L21 21 L12 21 Z" opacity=".5"/>' +
            '</svg>';

        var item = $(
            '<li class="menu__item selector" data-action="goblin_oper">' +
            '  <div class="menu__ico">' + icon + '</div>' +
            '  <div class="menu__text">Гоблин</div>' +
            '</li>'
        );

        // Привязываем hover:enter прямо на элемент!
        item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Тупичок Гоблина',
                component: 'goblin_oper',
                page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(item);
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') start();
    });

})();
