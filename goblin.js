(function () {
    'use strict';

    console.log('[Goblin] Скрипт загружен');

    function start() {
        console.log('[Goblin] start() вызвана');
        console.log('[Goblin] Lampa версии:', Lampa.Manifest ? Lampa.Manifest.app_digital : 'неизвестно');
        console.log('[Goblin] Lampa.Menu:', typeof Lampa.Menu);
        console.log('[Goblin] Lampa.Menu.addButton:', Lampa.Menu ? typeof Lampa.Menu.addButton : 'нет');
        console.log('[Goblin] Lampa.Component.add:', typeof Lampa.Component.add);
        console.log('[Goblin] .menu__list длина:', $('.menu .menu__list').length);

        /* ── Регистрируем компонент ────────────────── */
        try {
            Lampa.Component.add('goblin_oper', function (activity) {
                var self = this;
                self.activity = activity;
                self.html = $('<div></div>');

                self.render = function () { return self.html; };

                self.create = function () {
                    console.log('[Goblin] Component.create() вызван');
                    self.html.append(
                        '<div style="padding:60px;text-align:center;color:#fff">' +
                        '<div style="font-size:20px;margin-bottom:16px">Тупичок Гоблина</div>' +
                        '<div style="opacity:.6">Компонент работает! Добавляю видео...</div>' +
                        '</div>'
                    );
                    self.activity.toggle(false);
                    Lampa.Controller.toggle('content');
                };

                self.start = function () {
                    Lampa.Background.change('');
                    Lampa.Controller.toggle('content');
                };
                self.pause = function () {};
                self.stop = function () {};
                self.destroy = function () { self.html.remove(); };
            });
            console.log('[Goblin] Компонент зарегистрирован');
        } catch (e) {
            console.error('[Goblin] Ошибка регистрации компонента:', e.message);
        }

        /* ── Добавляем пункт меню ─────────────────── */
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
            console.log('[Goblin] Клик по пункту меню');
            Lampa.Activity.push({
                url: '',
                title: 'Тупичок Гоблина',
                component: 'goblin_oper',
                page: 1
            });
        });

        try {
            if (Lampa.Menu && typeof Lampa.Menu.addElement === 'function') {
                Lampa.Menu.addElement(item);
                console.log('[Goblin] Пункт добавлен через Lampa.Menu.addElement');
            } else {
                $('.menu .menu__list').eq(0).append(item);
                console.log('[Goblin] Пункт добавлен через .append()');
            }
        } catch (e) {
            console.error('[Goblin] Ошибка добавления меню:', e.message);
        }
    }

    if (window.appready) {
        console.log('[Goblin] appready = true, запускаю сразу');
        start();
    } else {
        console.log('[Goblin] appready = false, жду событие ready');
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') {
                console.log('[Goblin] Получено событие app:ready');
                start();
            }
        });
    }
})();
