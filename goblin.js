(function () {
    'use strict';

    var FEED_URL  = 'https://oper.ru/video.xml';
    var CACHE_TTL = 30 * 60 * 1000;
    var PAGE_SIZE = 30;

    var cache = {
        data: null,
        time: 0,
        get: function () {
            if (this.data && (Date.now() - this.time) < CACHE_TTL) return this.data;
            return null;
        },
        set: function (d) { this.data = d; this.time = Date.now(); }
    };

    function fetchFeed(onSuccess, onError) {
        var cached = cache.get();
        if (cached) { onSuccess(cached); return; }

        var xhr = new XMLHttpRequest();
        // Пробуем HTTPS, если не выйдет — HTTP
        xhr.open('GET', FEED_URL, true);
        xhr.timeout = 20000;

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status >= 200 && xhr.status < 400) {
                try {
                    var parsed = parseXML(xhr.responseText);
                    cache.set(parsed);
                    onSuccess(parsed);
                } catch (e) {
                    // Повтор через HTTP
                    tryHttpFallback(onSuccess, onError);
                }
            } else if (xhr.status === 0) {
                tryHttpFallback(onSuccess, onError);
            } else {
                onError('HTTP ' + xhr.status);
            }
        };

        xhr.ontimeout = function () { tryHttpFallback(onSuccess, onError); };
        xhr.onerror   = function () { tryHttpFallback(onSuccess, onError); };
        xhr.send();
    }

    function tryHttpFallback(onSuccess, onError) {
        if (cache.get()) { onSuccess(cache.get()); return; }
        var xhr2 = new XMLHttpRequest();
        xhr2.open('GET', 'http://oper.ru/video.xml', true);
        xhr2.timeout = 20000;
        xhr2.onreadystatechange = function () {
            if (xhr2.readyState !== 4) return;
            if (xhr2.status >= 200 && xhr2.status < 400) {
                try {
                    var parsed = parseXML(xhr2.responseText);
                    cache.set(parsed);
                    onSuccess(parsed);
                } catch (e) { onError('Ошибка парсинга: ' + e.message); }
            } else {
                onError('Не удалось загрузить фид (HTTP ' + xhr2.status + ')');
            }
        };
        xhr2.ontimeout = function () { onError('Таймаут запроса'); };
        xhr2.onerror   = function () { onError('Сетевая ошибка'); };
        xhr2.send();
    }

    function parseXML(xmlText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('Невалидный XML');

        var items = doc.getElementsByTagName('item');
        var videos = [];
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var title = getText(item, 'title');
            var link = getText(item, 'link');
            var pubDate = getText(item, 'pubDate');
            var enclosure = item.getElementsByTagName('enclosure')[0];
            var videoUrl = enclosure ? enclosure.getAttribute('url') : '';
            var duration = getITunes(item, 'duration');
            var category = getITunes(item, 'subtitle') || 'Разное';
            var imgHref = getITunesAttr(item, 'image', 'href');

            if (!imgHref) {
                var desc = getText(item, 'description') || '';
                var m = desc.match(/src="([^"]+)"/);
                if (m) imgHref = m[1];
            }
            if (!videoUrl) continue;

            // Приводим URL к HTTPS
            if (videoUrl.indexOf('http://') === 0) videoUrl = 'https://' + videoUrl.slice(7);
            if (imgHref && imgHref.indexOf('http://') === 0) imgHref = 'https://' + imgHref.slice(7);

            videos.push({
                id: link, title: title, url: videoUrl, pageUrl: link,
                poster: imgHref || '', category: category,
                duration: duration || '', pubDate: pubDate || '',
                description: stripHtml(getText(item, 'description') || '')
            });
        }
        return videos;
    }

    function getText(parent, tag) {
        var el = parent.getElementsByTagName(tag)[0];
        return el ? (el.textContent || '').trim() : '';
    }

    function getITunes(parent, tag) {
        var els = parent.getElementsByTagName(tag);
        for (var i = 0; i < els.length; i++) {
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 || els[i].localName === tag)
                return (els[i].textContent || '').trim();
        }
        return '';
    }

    function getITunesAttr(parent, tag, attr) {
        var els = parent.getElementsByTagName(tag);
        for (var i = 0; i < els.length; i++) {
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 || els[i].localName === tag)
                return els[i].getAttribute(attr);
        }
        return '';
    }

    function stripHtml(html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').trim().slice(0, 300);
    }

    function getCategories(videos) {
        var seen = {}, cats = [];
        for (var i = 0; i < videos.length; i++) {
            var c = videos[i].category;
            if (!seen[c]) { seen[c] = true; cats.push(c); }
        }
        return cats;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str || ''));
        return div.innerHTML;
    }

    /* ── Компонент ────────────────────────────────── */

    function GoblinComponent(activity) {
        var self = this;
        self.activity = activity;
        self.scroll = null;
        self.filter = null;
        self.allVideos = [];
        self.filtered = [];
        self.currentCategory = 'Все';
        self.currentPage = 1;
        self.html = $('<div></div>');

        /* render() — обязательно для Lampa */
        self.render = function () { return self.html; };

        self.create = function () {
            var container = $(
                '<div class="goblin-oper">' +
                '  <div class="goblin-oper__filter"></div>' +
                '  <div class="goblin-oper__content"></div>' +
                '</div>'
            );
            self.html.append(container);

            self.scroll = new Lampa.Scroll({ mask: true, over_mask: true });
            self.content = container.find('.goblin-oper__content');
            self.content.append(self.scroll.render());

            self.filterContainer = container.find('.goblin-oper__filter');

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
            var filterComponents = {};
            filterComponents.category = {
                title: 'Категория',
                items: [{ title: 'Все' }].concat(
                    cats.map(function (c) { return { title: c }; })
                )
            };

            self.filter = new Lampa.Filter({
                title: 'Тупичок Гоблина',
                results: self.allVideos.length,
                filter: filterComponents,
                onSort: function () {},
                onFilter: function (state) {
                    self.currentCategory = state.category.selected.title || 'Все';
                    self.applyFilter();
                },
                onBack: function () { Lampa.Activity.backward(); }
            });

            self.filterContainer.append(self.filter.render());
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
            var pageVideos = self.filtered.slice(0, end);
            var grid = $('<div class="goblin-oper__grid"></div>');

            pageVideos.forEach(function (video) {
                grid.append(self.createCard(video));
            });

            self.scroll.append(grid);

            if (end < self.filtered.length) {
                var moreBtn = $(
                    '<div class="goblin-oper__more selector">' +
                    '  <span>Ещё (' + (self.filtered.length - end) + ')</span>' +
                    '</div>'
                );
                moreBtn.on('hover:enter', function () {
                    self.currentPage++;
                    self.renderPage();
                });
                self.scroll.append(moreBtn);
            }

            self.activity.toggle(false);
            Lampa.Controller.toggle('content');
        };

        self.createCard = function (video) {
            var card = $(
                '<div class="card selector goblin-card">' +
                '  <div class="card__view">' +
                '    <img src="" alt="" class="card__img" />' +
                '    <div class="card__badge">' + escapeHtml(video.category) + '</div>' +
                '    <div class="card__play">' +
                '      <svg width="40" height="40" viewBox="0 0 40 40">' +
                '        <circle cx="20" cy="20" r="18" fill="rgba(0,0,0,0.6)" />' +
                '        <path d="M16 13 L28 20 L16 27 Z" fill="#fff" />' +
                '      </svg>' +
                '    </div>' +
                '  </div>' +
                '  <div class="card__title">' + escapeHtml(video.title) + '</div>' +
                '  <div class="card__subtitle">' + escapeHtml(video.duration) + '</div>' +
                '</div>'
            );

            if (video.poster) card.find('.card__img').attr('src', video.poster);
            else card.find('.card__img').hide();

            card.on('hover:enter', function () { self.playVideo(video); });
            return card;
        };

        self.playVideo = function (video) {
            Lampa.Player.play({ title: video.title, url: video.url });
            Lampa.Player.playlist([{ title: video.title, url: video.url }]);
            Lampa.Player.video({ id: video.id });
        };

        self.showLoading = function () {
            self.scroll.clear();
            self.scroll.append(
                '<div class="goblin-oper__loading">' +
                '  <div class="broadcast__scan"></div>' +
                '  <div>Загрузка видео…</div>' +
                '</div>'
            );
        };

        self.showError = function (msg) {
            self.scroll.clear();
            self.scroll.append(
                '<div class="goblin-oper__error">' +
                '  <div style="opacity:.7;margin-bottom:12px">Не удалось загрузить ленту</div>' +
                '  <div style="opacity:.5;font-size:.9em">' + escapeHtml(msg) + '</div>' +
                '</div>'
            );
            Lampa.Controller.toggle('content');
        };

        self.start  = function () { Lampa.Background.change(''); Lampa.Controller.toggle('content'); };
        self.pause  = function () {};
        self.stop   = function () {};
        self.destroy = function () {
            self.scroll.destroy();
            if (self.filter) self.filter.destroy();
            self.html.remove();
        };
    }

    /* ── CSS ──────────────────────────────────────── */

    function injectCSS() {
        if (document.getElementById('goblin-plugin-css')) return;
        var css =
            '.goblin-oper__grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; padding:16px; }' +
            '.goblin-card { cursor:pointer; border-radius:8px; overflow:hidden; background:rgba(255,255,255,.05); }' +
            '.goblin-card .card__view { position:relative; aspect-ratio:16/9; background:rgba(0,0,0,.3); }' +
            '.goblin-card .card__img { width:100%; height:100%; object-fit:cover; }' +
            '.goblin-card .card__badge { position:absolute; top:6px; left:6px; background:rgba(0,0,0,.7); color:#fff; font-size:11px; padding:2px 8px; border-radius:4px; }' +
            '.goblin-card .card__play { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); opacity:0; }' +
            '.goblin-card.focus .card__play { opacity:1; }' +
            '.goblin-card .card__title { padding:8px 10px 4px; font-size:13px; line-height:1.3; max-height:34px; overflow:hidden; }' +
            '.goblin-card .card__subtitle { padding:0 10px 10px; font-size:11px; opacity:.5; }' +
            '.goblin-oper__more { text-align:center; padding:20px; font-size:14px; opacity:.7; }' +
            '.goblin-oper__more.focus { opacity:1; }' +
            '.goblin-oper__loading, .goblin-oper__error { text-align:center; padding:60px 20px; opacity:.6; }';
        var style = document.createElement('style');
        style.id = 'goblin-plugin-css';
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* ── Инициализация ────────────────────────────── */

    function start() {
        if (window.plugin_goblin_oper_ready) return;
        window.plugin_goblin_oper_ready = true;

        injectCSS();
        Lampa.Component.add('goblin_oper', GoblinComponent);

        /* Добавляем кнопку через API Lampa */
        Lampa.Menu.addButton({
            title: 'Гоблин',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                  '<path d="M3 3 L12 3 L12 21 L3 21 Z"/>' +
                  '<path d="M12 3 L21 3 L21 21 L12 21 Z" opacity=".5"/>' +
                  '</svg>',
            action: 'goblin_oper'
        });

        /* Обработка нажатия через делегирование */
        $(document).on('hover:enter', '[data-action="goblin_oper"]', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Тупичок Гоблина',
                component: 'goblin_oper',
                page: 1,
                data: {}
            });
        });
    }

    if (window.appready) start();
    else Lampa.Listener.follow('app', function (e) {
        if (e.type === 'ready') start();
    });

})();
