(function () {
    'use strict';

    function startPlugin() {
        window.plugin_goblin_ready = true;

        function add() {
            // Визуальное уведомление — точно увидим, если плагин загрузился
            Lampa.Noty.show('Плагин Гоблин загружен');

            // Регистрируем компонент
            Lampa.Component.add('goblin_page', function (activity) {
                var self = this;
                self.activity = activity;
                self.html = $('<div></div>');

                self.render = function () { return self.html; };

                self.create = function () {
                    self.html.append(
                        '<div style="padding:60px;text-align:center;color:#fff">' +
                        '<div style="font-size:20px;margin-bottom:16px">Тупичок Гоблина</div>' +
                        '<div style="opacity:.6">Компонент работает!</div>' +
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

            // Добавляем пункт меню — правильный API!
            var icon = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M3 3 L12 3 L12 21 L3 21 Z"/>' +
                '<path d="M12 3 L21 3 L21 21 L12 21 Z" opacity=".5"/>' +
                '</svg>';

            Lampa.Menu.addButton(icon, 'Гоблин', function () {
                Lampa.Activity.push({
                    url: '',
                    title: 'Тупичок Гоблина',
                    component: 'goblin_page',
                    page: 1
                });
            });
        }

        if (window.appready) add();
        else Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') add();
        });
    }

    if (!window.plugin_goblin_ready) startPlugin();
})();
