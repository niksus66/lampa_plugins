(function () {
    'use strict';

    var FEED_URL = 'https://oper.ru/video.xml';
    var CACHE_TTL = 30 * 60 * 1000;
    var PAGE_SIZE = 30;

    var cache = { data: null, time: 0 };

    function getCache() {
        if (cache.data && (Date.now() - cache.time) < CACHE_TTL) return cache.data;
        return null;
    }
    function setCache(d) { cache.data = d; cache.time = Date.now(); }

    function fetchFeed(onOk, onErr) {
        var cached = getCache();
        if (cached) { onOk(cached); return; }

        var net = new Lampa.Reguest();
        net.timeout(20000);
        net.native(FEED_URL, function (data) {
            try { var v = parseXML(data); setCache(v); onOk(v); }
            catch (e) { onErr(e.message); }
        }, function () {
            net.native('http://oper.ru/video.xml', function (data2) {
                try { var v = parseXML(data2); setCache(v); onOk(v); }
                catch (e) { onErr(e.message); }
            }, function () { onErr('Сеть недоступна'); });
        });
    }

    function parseXML(xmlText) {
        var doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Невалидный XML');
        var items = doc.getElementsByTagName('item');
        var videos = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var title = txt(it, 'title');
            var link = txt(it, 'link');
            var enc = it.getElementsByTagName('enclosure')[0];
            var url = enc ? enc.getAttribute('url') : '';
            var dur = itNS(it, 'duration');
            var cat = itNS(it, 'subtitle') || 'Разное';
            var img = itNSAttr(it, 'image', 'href');
            if (!img) {
                var d = txt(it, 'description') || '';
                var m = d.match(/src="([^"]+)"/);
                if (m) img = m[1];
            }
            if (!url) continue;
            if (url.indexOf('http://') === 0) url = 'https://' + url.slice(7);
            if (img && img.indexOf('http://') === 0) img = 'https://' + img.slice(7);
            videos.push({
                id: link, title: title, url: url, poster: img || '',
                category: cat, duration: dur || ''
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
    function esc(s) {
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s || ''));
        return d.innerHTML;
    }

    function getCategories(videos) {
        var seen = {}, cats = [];
        for (var i = 0; i < videos.length; i++) {
            var c = videos[i].category;
            if (!seen[c]) { seen[c] = true; cats.push(c); }
        }
        return cats;
    }

    function injectCSS() {
        if (document.getElementById('goblin-css')) return;
        var s = document.createElement('style');
        s.id = 'goblin-css';
        s.textContent =
            '.goblin-wrap{padding:0;}' +
            '.goblin-toolbar{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px;}' +
            '.goblin-chip{padding:6px 14px;border-radius:20px;background:rgba(255,255,255,.08);font-size:13px;cursor:pointer;white-space:nowrap;}' +
            '.goblin-chip.active{background:var(--primary,#2196f3);color:#fff;}' +
            '.goblin-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:16px;}' +
            '.goblin-card{border-radius:8px;overflow:hidden;background:rgba(255,255,255,.05);cursor:pointer;}' +
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
    function GoblinComponent(object) {
        var self = this;
        self.object = object;

        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var html = $('<div class="goblin-wrap"></div>');
        var allVideos = [];
        var filtered = [];
        var currentPage = 1;
        var currentCategory = 'Все';
        var last = false;
        var toolbar = null;

        this.render = function () { return html; };

        this.create = function () {
            html.append(scroll.render());
            scroll.append($('<div class="goblin-loading"><div class="broadcast__scan"></div><div>Загрузка ленты…</div></div>'));

            fetchFeed(function (videos) {
                allVideos = videos;
                filtered = videos;
                self.renderPage();
            }, function (err) {
                scroll.clear();
                scroll.append(
                    $('<div class="goblin-error">' +
                      '<div style="opacity:.7;margin-bottom:12px">Не удалось загрузить ленту</div>' +
                      '<div style="opacity:.5;font-size:.9em">' + esc(err) + '</div></div>')
                );
                self.start();
            });

            return this.render();
        };

        self.buildToolbar = function () {
            var cats = getCategories(allVideos);
            toolbar = $('<div class="goblin-toolbar"></div>');

            var allChip = $('<div class="goblin-chip selector active">Все</div>');
            allChip.on('hover:enter', function () {
                currentCategory = 'Все';
                filtered = allVideos;
                currentPage = 1;
                toolbar.find('.goblin-chip').removeClass('active');
                allChip.addClass('active');
                self.renderPage();
            });
            toolbar.append(allChip);

            cats.forEach(function (c) {
                var chip = $('<div class="goblin-chip selector">' + esc(c) + '</div>');
                chip.on('hover:enter', function () {
                    currentCategory = c;
                    filtered = allVideos.filter(function (v) { return v.category === c; });
                    currentPage = 1;
                    toolbar.find('.goblin-chip').removeClass('active');
                    chip.addClass('active');
                    self.renderPage();
                });
                toolbar.append(chip);
            });

            return toolbar;
        };

        self.renderPage = function () {
            scroll.clear();
            scroll.reset();

            if (!toolbar) toolbar = self.buildToolbar();
            scroll.append(toolbar);

            var end = currentPage * PAGE_SIZE;
            var page = filtered.slice(0, end);
            var grid = $('<div class="goblin-grid"></div>');

            page.forEach(function (v) { grid.append(self.makeCard(v)); });
            scroll.append(grid);

            if (end < filtered.length) {
                var more = $('<div class="goblin-more selector"><span>Ещё (' + (filtered.length - end) + ')</span></div>');
                more.on('hover:enter', function () {
                    currentPage++;
                    self.renderPage();
                });
                scroll.append(more);
            }

            object.activity.toggle(false);
            self.start();
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
            card.on('hover:focus', function (e) {
                last = e.target;
                scroll.update($(e.target), true);
            });

            return card;
        };

        self.playVideo = function (v) {
            Lampa.Player.play({ title: v.title, url: v.url });
            Lampa.Player.playlist([{ title: v.title, url: v.url }]);
            Lampa.Player.video({ id: v.id });
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () { Navigator.move('up'); },
                down: function () { Navigator.move('down'); },
                right: function () { Navigator.move('right'); },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    /* ── Инициализация ───────────────────────── */
    function start() {
        injectCSS();
        Lampa.Component.add('goblin_oper', GoblinComponent);

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
