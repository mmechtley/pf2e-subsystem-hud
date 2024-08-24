import {
    MODULE,
    createHTMLElement,
    htmlQuery,
    localize,
    registerSetting,
    userIsGM
} from "foundry-pf2e";
import { PF2eHudTrackers } from "./hud/trackers";

MODULE.register("pf2e-subsystem-hud", "PF2E Subsystem HUD");

const HUDS = {
    trackers: new PF2eHudTrackers()
};

Hooks.once("setup", () => {
    const repeat = require('handlebars-helper-repeat');
    Handlebars.registerHelper('repeat', repeat);

    const isGM = userIsGM();
    const huds = Object.values(HUDS);
    const settings: SettingOptions[] = [];

    for (const hud of huds) {
        const currentOffset = settings.length;
        const orphanSettings: SettingOptions[] = [];

        for (const setting of hud.getSettings()) {
            const key = `${hud.key}.${setting.key}`;
            const index = hud.SETTINGS_ORDER.indexOf(setting.key as any);

            if (setting.default === undefined) {
                setting.default = localize(`settings.${key}.default`);
            }

            setting.key = key;

            if (index !== -1) settings[index + currentOffset] = setting;
            else orphanSettings.push(setting);
        }

        settings.push(...orphanSettings);
    }

    for (const setting of settings) {
        if (setting.gmOnly && !isGM) continue;
        registerSetting(setting);
    }

    MODULE.current.api = {
        hud: HUDS
    };

    // @ts-ignore
    game.hud = {
        ...HUDS
    };

    for (const hud of huds) {
        hud.enable();
    }
});

Hooks.on("renderSettingsConfig", (app: SettingsConfig, $html: JQuery) => {
    const html = $html[0];
    const tab = htmlQuery(html, `.tab[data-tab="${MODULE.id}"]`);

    for (const hud of Object.values(HUDS)) {
        const group = htmlQuery(tab, `[data-setting-id^="${MODULE.id}.${hud.key}."]`);
        if (!group) continue;

        const titleElement = createHTMLElement("h3", {
            innerHTML: localize("settings", hud.key, "title"),
        });

        group.before(titleElement);

        //

        const gmOnlyLabel = localize("gmOnly");
        const reloadLabel = localize("reload");

        for (const setting of hud.getSettings()) {
            const nameExtras: string[] = [];

            if (setting.gmOnly) nameExtras.push(gmOnlyLabel);
            if (setting.requiresReload) nameExtras.push(reloadLabel);

            if (!nameExtras.length) continue;

            const key = `${MODULE.id}.${hud.key}.${setting.key}`;
            const labelElement = htmlQuery(tab, `[data-setting-id="${key}"] > label`);
            const extraElement = createHTMLElement("span", {
                innerHTML: ` (${nameExtras.join(", ")})`,
            });

            labelElement?.append(extraElement);
        }
    }
});

export { HUDS as hud };