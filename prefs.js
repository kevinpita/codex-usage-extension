import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class CodexUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Codex Usage Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Configure the Codex Usage extension',
        });
        page.add(generalGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to refresh usage data (in seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 600,
                step_increment: 10,
                page_increment: 60,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind(
            'refresh-interval',
            refreshRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        generalGroup.add(refreshRow);

        const displayGroup = new Adw.PreferencesGroup({
            title: 'Panel Display',
            description: 'Configure how usage is shown in the top panel',
        });
        page.add(displayGroup);

        const displayModeRow = new Adw.ComboRow({
            title: 'Display Mode',
            subtitle: 'Show usage as a ring, text percentage, progress bar, or both',
        });

        const displayModeModel = new Gtk.StringList();
        displayModeModel.append('Ring + Percentage');
        displayModeModel.append('Text (percentage)');
        displayModeModel.append('Progress Bar');
        displayModeModel.append('Bar + Percentage');
        displayModeRow.set_model(displayModeModel);

        const currentMode = settings.get_string('display-mode');
        const modeIndex = currentMode === 'text' ? 1
            : currentMode === 'bar' ? 2
                : currentMode === 'both' ? 3
                    : 0;
        displayModeRow.set_selected(modeIndex);

        displayModeRow.connect('notify::selected', () => {
            const selected = displayModeRow.get_selected();
            const modes = ['ring', 'text', 'bar', 'both'];
            settings.set_string('display-mode', modes[selected]);
        });

        displayGroup.add(displayModeRow);

        const panelWindowRow = new Adw.ComboRow({
            title: 'Panel Reflects',
            subtitle: 'Choose the usage window used for panel color and percentage',
        });

        const panelWindowModel = new Gtk.StringList();
        panelWindowModel.append('Most constrained');
        panelWindowModel.append('5-hour window');
        panelWindowModel.append('7-day window');
        panelWindowRow.set_model(panelWindowModel);

        const currentPanelWindow = settings.get_string('panel-window');
        panelWindowRow.set_selected(currentPanelWindow === 'primary' ? 1
            : currentPanelWindow === 'secondary' ? 2
                : 0);

        panelWindowRow.connect('notify::selected', () => {
            const selected = panelWindowRow.get_selected();
            const windows = ['max', 'primary', 'secondary'];
            settings.set_string('panel-window', windows[selected]);
        });

        displayGroup.add(panelWindowRow);

        const usageDisplayRow = new Adw.ComboRow({
            title: 'Usage Values',
            subtitle: 'Show consumed usage or remaining allowance',
        });

        const usageDisplayModel = new Gtk.StringList();
        usageDisplayModel.append('Used');
        usageDisplayModel.append('Remaining');
        usageDisplayRow.set_model(usageDisplayModel);

        const currentUsageDisplay = settings.get_string('usage-display');
        usageDisplayRow.set_selected(currentUsageDisplay === 'remaining' ? 1 : 0);

        usageDisplayRow.connect('notify::selected', () => {
            const selected = usageDisplayRow.get_selected();
            settings.set_string('usage-display', selected === 1 ? 'remaining' : 'used');
        });

        displayGroup.add(usageDisplayRow);

        const iconStyleRow = new Adw.ComboRow({
            title: 'Icon Style',
            subtitle: 'Use a color or monochrome icon in the panel',
        });

        const iconStyleModel = new Gtk.StringList();
        iconStyleModel.append('Color');
        iconStyleModel.append('Monochrome');
        iconStyleRow.set_model(iconStyleModel);

        const currentStyle = settings.get_string('icon-style');
        iconStyleRow.set_selected(currentStyle === 'monochrome' ? 1 : 0);

        iconStyleRow.connect('notify::selected', () => {
            const selected = iconStyleRow.get_selected();
            settings.set_string('icon-style', selected === 1 ? 'monochrome' : 'color');
        });

        displayGroup.add(iconStyleRow);

        const showIconRow = new Adw.SwitchRow({
            title: 'Show Icon',
            subtitle: 'Display the Codex icon in the top bar',
        });
        settings.bind(
            'show-icon',
            showIconRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(showIconRow);

        const showTierRow = new Adw.SwitchRow({
            title: 'Show Tier',
            subtitle: 'Display the detected plan or CODEX fallback in the top bar',
        });
        settings.bind(
            'show-tier',
            showTierRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        displayGroup.add(showTierRow);

        const menuGroup = new Adw.PreferencesGroup({
            title: 'Menu',
            description: 'Configure what the dropdown menu shows',
        });
        page.add(menuGroup);

        const additionalLimitsRow = new Adw.SwitchRow({
            title: 'Show Additional Limits',
            subtitle: 'Display model-specific limits (e.g. GPT-5.3-Codex-Spark) in the menu',
        });
        settings.bind(
            'show-additional-limits',
            additionalLimitsRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        menuGroup.add(additionalLimitsRow);

        const networkGroup = new Adw.PreferencesGroup({
            title: 'Network',
            description: 'Configure network settings',
        });
        page.add(networkGroup);

        const proxyRow = new Adw.EntryRow({
            title: 'Proxy URL',
            show_apply_button: true,
        });
        proxyRow.set_text(settings.get_string('proxy-url'));
        proxyRow.connect('apply', () => {
            settings.set_string('proxy-url', proxyRow.get_text());
        });
        networkGroup.add(proxyRow);

        const proxyHint = new Gtk.Label({
            label: 'Example: http://localhost:11809 (leave empty for no proxy)',
            xalign: 0,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        });
        networkGroup.add(proxyHint);
    }
}
