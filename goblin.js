(function () {
    'use strict';

    /*
     * Плагин Lampa: Тупичок Гоблина (oper.ru)
     * Источник: http://oper.ru/video.xml (RSS 2.0)
     * Воспроизведение прямых MP4-ссылок через встроенный плеер Lampa
     */

    var FEED_URL  = 'http://oper.ru/video.xml';
    var CACHE_TTL = 30 * 60 * 1000; // 30 минут
    var PAGE_SIZE = 30;

    /* ── Кэш ─────────────────────────────────────────── */

    var cache = {
        data: null,
        time: 0,
        get: function () {
            if (this.data && (Date.now() - this.time) < CACHE_TTL) return this.data;
            return null;
        },
        set: function (d) { this.data = d; this.time = Date.now(); }
    };

    /* ── Загрузка и парсинг XML ─────────────────────── */

    function fetchFeed(onSuccess, onError) {
        var cached = cache.get();
        if (cached) { onSuccess(cached); return; }

        var xhr = new XMLHttpRequest();
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
                    onError('Ошибка парсинга XML: ' + e.message);
                }
            } else {
                onError('HTTP ' + xhr.status);
            }
        };

        xhr.ontimeout = function () { onError('Таймаут запроса'); };
        xhr.onerror   = function () { onError('Сетевая ошибка'); };
        xhr.send();
    }

    function parseXML(xmlText) {
        var parser = new DOMParser();
        var doc = parser.parseFromString(xmlText, 'text/xml');

        if (doc.getElementsByTagName('parsererror').length) {
            throw new Error('Невалидный XML');
        }

        var items = doc.getElementsByTagName('item');
        var videos = [];

        for (var i = 0; i < items.length; i++) {
            var item = items[i];

            var title     = getText(item, 'title');
            var link      = getText(item, 'link');
            var pubDate   = getText(item, 'pubDate');
            var enclosure = item.getElementsByTagName('enclosure')[0];
            var videoUrl  = enclosure ? enclosure.getAttribute('url') : '';
            var duration  = getITunes(item, 'duration');
            var category  = getITunes(item, 'subtitle') || 'Разное';
            var imgHref   = getITunesAttr(item, 'image', 'href');

            // Если нет картинки в itunes:image — пробуем извлечь из description
            if (!imgHref) {
                var desc = getText(item, 'description') || '';
                var m = desc.match(/src="([^"]+)"/);
                if (m) imgHref = m[1];
            }

            if (!videoUrl) continue;

            videos.push({
                id:          link,
                title:       title,
                url:         videoUrl,
                pageUrl:     link,
                poster:      imgHref || '',
                category:    category,
                duration:    duration || '',
                pubDate:     pubDate || '',
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
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 ||
                els[i].localName === tag) {
                return (els[i].textContent || '').trim();
            }
        }
        return '';
    }

    function getITunesAttr(parent, tag, attr) {
        var els = parent.getElementsByTagName(tag);
        for (var i = 0; i < els.length; i++) {
            if (els[i].namespaceURI && els[i].namespaceURI.indexOf('itunes') > -1 ||
                els[i].localName === tag) {
                return els[i].getAttribute(attr);
            }
        }
        return '';
    }

    function stripHtml(html) {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        return (tmp.textContent || tmp.innerText || '').trim().slice(0, 300);
    }

    /* ── Уникальные категории ───────────────────────── */

    function getCategories(videos) {
        var seen = {};
        var cats = [];
        for (var i = 0; i < videos.length; i++) {
            var c = videos[i].category;
            if (!seen[c]) { seen[c] = true; cats.push(c); }
        }
        return cats;
    }

    /* ── Компонент-экран ────────────────────────────── */

    function GoblinComponent(activity) {
        var self = this;

        this.activity = activity;
        this.scroll = null;
        this.filter = null;
        this.allVideos = [];
        this.filtered = [];
        this.currentCategory = 'Все';
        this.currentPage = 1;
        this.network = new Lampa.Reguest();

        /* ── create ──────────────────────────────── */

        this.create = function () {
            var html = $('<div class="goblin-oper">\
                <div class="goblin-oper__filter"></div>\
                <div class="goblin-oper__content"></div>\
            </div>');

            self.activity.render().append(html);
            self.body = html;

            self.scroll = new Lampa.Scroll({
                mask: true,
                over_mask: true
            });

            self.content = self.body.find('.goblin-oper__content');
            self.content.append(self.scroll.render());

            self.filterContainer = self.body.find('.goblin-oper__filter');

            self.showLoading();

            fetchFeed(function (videos) {
                self.allVideos = videos;
                self.buildFilter();
                self.applyFilter();
            }, function (err) {
                self.showError(err);
            });
        };

        /* ── Фильтр по категориям ────────────────── */

        this.buildFilter = function () {
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
                    self.currentPage = 1;
                    self.applyFilter();
                },
                onBack: function () {
                    Lampa.Activity.backward();
                }
            });

            self.filterContainer.append(self.filter.render());
        };

        /* ── Применение фильтра ───────────────────── */

        this.applyFilter = function () {
            self.filtered = self.allVideos.filter(function (v) {
                return self.currentCategory === 'Все' || v.category === self.currentCategory;
            });

            self.currentPage = 1;
            self.renderPage();
        };

        /* ── Рендер страницы ─────────────────────── */

        this.renderPage = function () {
            self.scroll.clear();
            self.scroll.reset();

            var end = self.currentPage * PAGE_SIZE;
            var pageVideos = self.filtered.slice(0, end);

            var grid = $('<div class="goblin-oper__grid"></div>');

            pageVideos.forEach(function (video) {
                var card = self.createCard(video);
                grid.append(card);
            });

            self.scroll.append(grid);

            // Кнопка "Ещё"
            if (end < self.filtered.length) {
                var moreBtn = $('<div class="goblin-oper__more selector">\
                    <span>Ещё (' + (self.filtered.length - end) + ')</span>\
                </div>');

                moreBtn.on('hover:enter', function () {
                    self.currentPage++;
                    self.renderPage();
                });

                self.scroll.append(moreBtn);
            }

            self.activity.toggle(false);
            Lampa.Controller.toggle('content');
        };

        /* ── Карточка видео ──────────────────────── */

        this.createCard = function (video) {
            var cardHtml = $(
                '<div class="card selector goblin-card">\
                    <div class="card__view">\
                        <img src="" alt="" class="card__img" />\
                        <div class="card__badge">' + escapeHtml(video.category) + '</div>\
                        <div class="card__play">\
                            <svg width="40" height="40" viewBox="0 0 40 40">\
                                <circle cx="20" cy="20" r="18" fill="rgba(0,0,0,0.6)" />\
                                <path d="M16 13 L28 20 L16 27 Z" fill="#fff" />\
                            </svg>\
                        </div>\
                    </div>\
                    <div class="card__title">' + escapeHtml(video.title) + '</div>\
                    <div class="card__subtitle">' + escapeHtml(video.duration) + '</div>\
                </div>'
            );

            if (video.poster) {
                cardHtml.find('.card__img').attr('src', video.poster);
            } else {
                cardHtml.find('.card__img').hide();
            }

            cardHtml.on('hover:enter', function () {
                self.playVideo(video);
            });

            return cardHtml;
        };

        /* ── Запуск плеера ──────────────────────── */

        this.playVideo = function (video) {
            Lampa.Player.play({
                title: video.title,
                url: video.url
            });

            Lampa.Player.playlist([{
                title: video.title,
                url: video.url
            }]);

            Lampa.Player.video({
                id: video.id
            });
        };

        /* ── Загрузка / ошибки ──────────────────── */

        this.showLoading = function () {
            self.scroll.clear();
            self.scroll.append(
                '<div class="goblin-oper__loading">\
                    <div class="broadcast__scan"></div>\
                    <div>Загрузка видео…</div>\
                </div>'
            );
        };

        this.showError = function (msg) {
            self.scroll.clear();
            self.scroll.append(
                '<div class="goblin-oper__error">\
                    <div style="opacity:.7;margin-bottom:12px">Не удалось загрузить ленту</div>\
                    <div style="opacity:.5;font-size:.9em">' + escapeHtml(msg) + '</div>\
                </div>'
            );
            Lampa.Controller.toggle('content');
        };

        /* ── start / pause / stop / destroy ─────── */

        this.start = function () {
            Lampa.Background.change('');
            Lampa.Controller.toggle('content');
        };

        this.pause  = function () {};
        this.stop   = function () {};

        this.destroy = function () {
            self.network.clear();
            self.scroll.destroy();
            if (self.filter) self.filter.destroy();
            self.body.remove();
        };
    }

    /* ── Вспомогательные ─────────────────────────── */

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str || ''));
        return div.innerHTML;
    }

    /* ── Пункт в боковом меню ────────────────────── */

    function addMenuItem() {
        var menuIcon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">\
            <path d="M3 3 L12 3 L12 21 L3 21 Z" />\
            <path d="M12 3 L21 3 L21 21 L12 21 Z" opacity=".5" />\
        </svg>';

        var item = $(
            '<li class="menu__item selector" data-action="goblin_oper">\
                <div class="menu__ico">' + menuIcon + '</div>\
                <div class="menu__text">Гоблин</div>\
            </li>'
        );

        item.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '',
                title: 'Тупичок Гоблина',
                component: 'goblin_oper',
                page: 1,
                data: {}
            });
        });

        $('.menu .menu__list').append(item);
    }

    /* ── CSS ──────────────────────────────────────── */

    function injectCSS() {
        var css =
            '.goblin-oper__grid {' +
            '  display: grid;' +
            '  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));' +
            '  gap: 16px; padding: 16px;' +
            '}' +
            '.goblin-card {' +
            '  cursor: pointer; border-radius: 8px; overflow: hidden;' +
            '  background: rgba(255,255,255,.05); transition: transform .15s;' +
            '}' +
            '.goblin-card:hover, .goblin-card.focus {' +
            '  transform: scale(1.03);' +
            '}' +
            '.goblin-card .card__view {' +
            '  position: relative; aspect-ratio: 16/9; background: rgba(0,0,0,.3);' +
            '}' +
            '.goblin-card .card__img {' +
            '  width: 100%; height: 100%; object-fit: cover;' +
            '}' +
            '.goblin-card .card__badge {' +
            '  position: absolute; top: 6px; left: 6px;' +
            '  background: rgba(0,0,0,.7); color: #fff; font-size: 11px;' +
            '  padding: 2px 8px; border-radius: 4px;' +
            '}' +
            '.goblin-card .card__play {' +
            '  position: absolute; top: 50%; left: 50%;' +
            '  transform: translate(-50%,-50%);' +
            '  opacity: 0; transition: opacity .2s;' +
            '}' +
            '.goblin-card:hover .card__play, .goblin-card.focus .card__play {' +
            '  opacity: 1;' +
            '}' +
            '.goblin-card .card__title {' +
            '  padding: 8px 10px 4px; font-size: 13px; line-height: 1.3;' +
            '  max-height: 34px; overflow: hidden;' +
            '}' +
            '.goblin-card .card__subtitle {' +
            '  padding: 0 10px 10px; font-size: 11px; opacity: .5;' +
            '}' +
            '.goblin-oper__more {' +
            '  text-align: center; padding: 20px; font-size: 14px; opacity: .7; cursor: pointer;' +
            '}' +
            '.goblin-oper__more:hover, .goblin-oper__more.focus {' +
            '  opacity: 1;' +
            '}' +
            '.goblin-oper__loading, .goblin-oper__error {' +
            '  text-align: center; padding: 60px 20px; opacity: .6;' +
            '}';

        $('<style>').text(css).appendTo('head');
    }

    /* ── Инициализация ────────────────────────────── */

    function startPlugin() {
        if (window.plugin_goblin_oper_ready) return;
        window.plugin_goblin_oper_ready = true;

        function init() {
            injectCSS();
            Lampa.Component.add('goblin_oper', GoblinComponent);
            addMenuItem();
        }

        if (window.appready) init();
        else Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    }

    startPlugin();
})();
