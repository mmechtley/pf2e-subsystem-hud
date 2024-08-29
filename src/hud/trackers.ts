import {
    addListenerAll,
    createHTMLElement,
    elementDataset,
    htmlClosest,
    htmlQuery,
    localize,
    render,
    settingPath,
    templateLocalize,
    toggleControlTool,
    waitDialog,
} from "foundry-pf2e";
import { BaseRenderOptions, BaseSettings, PF2eSubsystemHudBase } from "./base/base";

const DEFAULT_POSITION = { left: 150, top: 100 };
const ACCUMULATING_STEPS = {"cf": -1, "f": 0, "s": 1, "cs": 2};
const DIMINISHING_STEPS = {"cf": -2, "f": -1, "s": 0, "cs": 1};

function createStepTooltip(tracker: Tracker, direction: "increase" | "decrease") {
    const steps : string[] = [];
    steps.push(
        localize("trackers", direction, {
            click: localize("trackers.step"),
            value: tracker.step || 1,
        })
    );
    steps.push(
        localize("trackers", direction, {
            click: localize('trackers.shiftMultiplier'),
            value: (tracker.shiftMultiplier || 1) * (tracker.step || 1)
        })
    );

    steps.unshift(localize("trackers.edit"));

    return steps.join("<br>");
}

class PF2eHudTrackers extends PF2eSubsystemHudBase<TrackerSettings> {
    #initialized: boolean = false;
    skillChoices:SkillChoice[] = [];

    static DEFAULT_OPTIONS: PartialApplicationConfiguration = {
        id: "pf2e-subsystem-hud-trackers",
        window: {
            positioned: true,
            frame: true,
        },
        position: {
            width: "auto",
            height: "auto",
        },
    };

    get key(): "trackers" {
        return "trackers";
    }

    get templates() {
        return ["tracker"];
    }

    get SETTINGS_ORDER(): (keyof TrackerSettings)[] {
    return ["fontSize"];
}

get worldTrackers() {
    return this.getSetting("worldTrackers").slice();
}

get extraSkills() : SkillChoice[] {
    return this.getSetting("extraSkills").split(',')
        .map(s => {return {slug: game.pf2e.system.sluggify(s.trim()), label: s.trim()}});
}

getSettings() {
    const parentSettings = super.getSettings();

    return parentSettings.concat([
        {
            key: "worldTrackers",
            type: Array,
            default: [],
            config: false,
            onChange: () => {
                this.render();
            },
        },
        {
            key: "position",
            type: Object,
            default: { ...DEFAULT_POSITION },
            scope: "client",
            config: false,
        },
        {
            key: "extraSkills",
            type: String,
            default: [],
            config: true,
            scope: "world",
            name: settingPath("extraSkills.name"),
            hint: settingPath("extraSkills.hint"),
            onChange: () => {
                this.render();
                },
        },
        {
            key: "showTracker",
            type: Boolean,
            default: false,
            config: false,
            onChange: ( showTracker ) => {
                toggleControlTool("pf2e-subsystem-hud-trackers", showTracker);

                if (showTracker) this.render(true);
                else this.close();

                return;
            }
        }
    ]);
}

_onEnable() {

    if (this.#initialized) return;
    this.#initialized = true;

    this.skillChoices = Object.entries(CONFIG.PF2E.skills).map( k => {return {
        slug: k[0],
        label: k[1].label
    }});

    this.skillChoices.sort((a,b) => {return localize(a.label).localeCompare(localize(b.label))});
    this.skillChoices.unshift({slug:"perception", label:"PF2E.PerceptionLabel"})
    this.skillChoices.push({slug:"lore", label: "pf2e-subsystem-hud.trackers.lore" })

    Hooks.on("getSceneControlButtons", this.#onGetSceneControlButtons.bind(this));

    if (this.getSetting("showTracker")) this.render(true);
}

async _prepareContext(options: TrackerRenderOptions): Promise<TrackerContext> {
    const trackerContext = (tracker: Tracker) => {
        const validated = this.validateTracker(tracker) as ContextTracker;

        validated.ratio = (validated.value - validated.min) / (validated.max - validated.min);

        validated.increase = createStepTooltip(validated, "increase");
        validated.decrease = createStepTooltip(validated, "decrease");

        return validated;
    };

    const isGM = game.user.isGM;
    const worldTrackers = isGM
        ? this.worldTrackers
        : this.worldTrackers.filter((tracker) => tracker.visible);

    const skillsMap = Object.fromEntries( this.skillChoices.concat(this.extraSkills)
        .map(s => {return [s.slug, s.label];}));

    return {
        skillsMap: skillsMap,
        isGM,
        worldTrackers: worldTrackers.map((tracker) => trackerContext(tracker)),
        i18n: templateLocalize("trackers"),
    };
}

_onFirstRender(context: TrackerContext, options: TrackerRenderOptions) {
    const { left, top } = this.getSetting("position");
    options.position ??= {};
    options.position.left = left;
    options.position.top = top;
}

async _renderFrame(options: TrackerRenderOptions) {
    const frame = await super._renderFrame(options);
    const windowHeader = htmlQuery(frame, ".window-header")!;

    const template = await render("trackers/header", {
        i18n: templateLocalize("trackers"),
        isGM: game.user.isGM
    });

    const header = createHTMLElement("div", {
        innerHTML: template,
    });

    frame.dataset.tooltipClass = "pf2e-subsystem-hud-trackers-tooltip";
    windowHeader.replaceChildren(...header.children);

    return frame;
}

async _renderHTML(context: TrackerContext, options: TrackerRenderOptions) {
    return await this.renderTemplate("tracker", context);
}

_replaceHTML(result: string, content: HTMLElement, options: TrackerRenderOptions) {
    content.innerHTML = result;

    this.element!.style.setProperty(`--font-size`, `${options.fontSize}px`);

    this.#activateListeners(content);
}

_onPosition(position: ApplicationPosition) {
    this.#setPositionDebounce();
}

async _onClickAction(event: PointerEvent, target: HTMLElement) {
    if (event.button !== 0) return;
    if(!game.user.isGM) return;

    const action = target.dataset.action as TrackerActionEvent;

    switch (action) {
        case "add-tracker": {
            this.createTracker();
            break;
        }

        default: {
            const step = action as TrackerStep || "step";
            const parent = htmlClosest(target, "[data-tracker-id]")!;
            const { trackerId } = elementDataset(parent);
            this.moveTrackerByStep(trackerId, step, event.shiftKey);
        }
    }
}

getTracker(id: string) {
    const trackers = this.worldTrackers;
    const tracker = trackers.find((x) => x.id === id);
    return tracker ? this.validateTracker(tracker) : null;
}

async createTracker() {
    if (!game.user.isGM) return;

    const id = foundry.utils.randomID();
    const tracker = await this.#openTrackerMenu({
        id,
        name: localize("trackers.menu.name.default"),
        max: 6,
        min: 0,
        value: 0,
        mode: "pips",
        stepMode: "accumulating",
        pipImagePath: "",
        skills: [],
        step: 1,
        shiftMultiplier: 1
    });

    if (tracker) {
        return this.addTracker(tracker);
    }
}

addTracker(tracker: Tracker) {
    if (!game.user.isGM) return;

    const trackers = this.worldTrackers;
    trackers.push(tracker);

    return this.setTrackers(trackers);
}

moveTrackerByStep(trackerId: string, step: TrackerStep, useMultiplier: boolean) {
    const tracker = this.getTracker(trackerId);
    if (!tracker) return;

    const multiplier = useMultiplier ? (tracker.shiftMultiplier || 1) : 1;

    let modifyValue: number;
    switch (step)
    {
        case "decrease-points": {
            modifyValue = -(tracker.step || 1) * multiplier
            break;
        }
        case "increase-points": {
            modifyValue = (tracker.step || 1) * multiplier
            break;
        }
        default: {
            const steps = tracker.stepMode === "diminishing" ? DIMINISHING_STEPS : ACCUMULATING_STEPS;
            modifyValue = steps[step];
        }
    }

    this.changeTrackerQuantity(trackerId, modifyValue);
}

changeTrackerQuantity(id: string, nb: number) {
    if (!game.user.isGM) return;

    const tracker = this.getTracker(id);
    if (!tracker) return;

    const currentValue = Math.clamp(tracker.value, tracker.min, tracker.max);
    const newValue = Math.clamp(currentValue + nb, tracker.min, tracker.max);
    if (newValue === tracker.value) return;

    tracker.value = newValue;
    return this.updateTracker(tracker);
}

updateTracker(tracker: Tracker) {
    if (!game.user.isGM) return;

    const trackers = this.worldTrackers;
    const found = trackers.findSplice((x) => x.id === tracker.id, tracker);
    if (!found) return;

    return this.setTrackers(trackers);
}

async editTracker(id: string) {
    if (!game.user.isGM) return;

    const tracker = this.getTracker(id);
    if (!tracker) return;

    const editedTracker = await this.#openTrackerMenu(tracker, true);
    if (!editedTracker) return;

    if (editedTracker.delete) {
        return this.deleteTracker(id);
    } else {
        delete editedTracker.delete;
        return this.updateTracker(editedTracker);
    }
}

deleteTracker(id: string) {
    if (!game.user.isGM) return;

    const trackers = this.worldTrackers;
    const found = trackers.findSplice((x) => x.id === id);
    if (!found) return;

    return this.setTrackers(trackers);
}

setTrackers(trackers: Tracker[]) {
    if (!game.user.isGM) return;
    return this.setSetting("worldTrackers", trackers);
}

validateTracker<T extends Tracker>(tracker: T): T {
    const { id, max = 0, min = 0, name = "", value = 0, mode = "pips", stepMode = "accumulating", skills=[] } = tracker;
    const validatedMin = Number(min) || 0;
    const validatedMax = Math.max(validatedMin + 2, Number(max) || 0);

    return {
        ...tracker,
        id,
        name: name.trim() ?? id,
        min: validatedMin,
        max: validatedMax,
        value: Math.clamp(Number(value) || 0, validatedMin, validatedMax),
        mode: mode,
        stepMode: stepMode,
        skills: skills
    };
}

async #openTrackerMenu(tracker: Tracker, isEdit = false) {


    const editedTracker = await waitDialog<MenuTracker>({
            title: localize("trackers.menu.title", isEdit ? "edit" : "create"),
            content: "trackers/tracker-menu",
            classes: ["pf2e-subsystem-hud-trackers-menu"],
            yes: {
                label: localize("trackers.menu.button.yes", isEdit ? "edit" : "create"),
                default: true,
            },
            no: {
                label: localize("trackers.menu.button.no"),
            },
            data: {
                tracker: tracker,
                skillChoices: this.skillChoices.concat(this.extraSkills),
                isEdit,
                i18n: templateLocalize("trackers"),
            },
            render: (event, html) => {
                const btn = createHTMLElement("a", {
                    dataset: {
                        tooltip: tracker.id,
                        tooltipDirection: "UP",
                    },
                    innerHTML: "<i class='fa-solid fa-earth-americas'></i>"
                });

                btn.style.marginLeft = "0.3em";

                btn.addEventListener("click", (event) => {
                    event.preventDefault();
                    game.clipboard.copyPlainText(tracker.id);
                    ui.notifications.info(
                        game.i18n.format("DOCUMENT.IdCopiedClipboard", {
                            label: localize("trackers.tracker"),
                            type: "id",
                            id: tracker.id,
                        })
                    );
                });

                html.querySelector(".window-header .window-title")?.append(btn);
            },
        },
            {
                id: "tracker-await-dialog"
            }
    );

    return editedTracker ? this.validateTracker(editedTracker) : null;
}

#setPositionDebounce = foundry.utils.debounce(() => {
    const newPosition = foundry.utils.mergeObject(DEFAULT_POSITION, this.position, {
        inplace: false,
    });
    this.setSetting("position", newPosition);
}, 1000);

#onGetSceneControlButtons(controls: SceneControl[]) {
    if(!game.user.isGM) return;

    controls[0].tools.push({
        title: settingPath("trackers.title"),
        name: "pf2e-subsystem-hud-trackers",
        icon: "fa-regular fa-shield-check",
        toggle: true,
        visible: true,
        active: this.getSetting("showTracker"),
        onClick: (active) => {
            this.setSetting("showTracker", active);
        },
    });
}

#activateListeners(html: HTMLElement) {
    addListenerAll(html, "[data-tracker-id]", "contextmenu", async (event, el) => {
        const { trackerId } = elementDataset(el);
        this.editTracker(trackerId);
    });
}
}

type TrackerStep = "decrease-points" | "increase-points" | "cs" | "s" | "f" | "cf";
type TrackerActionEvent = "add-tracker" | TrackerStep;
type TrackerDisplayMode = "meter" | "pips";
type TrackerStepMode = "manual" | "accumulating" | "diminishing";

type SkillChoice = {
    slug: string,
    label: string
}

type TrackerContext = {
    skillsMap: {};
    isGM: boolean;
    i18n: ReturnType<typeof templateLocalize>;
    worldTrackers: ContextTracker[];
};

type TrackerRenderOptions = BaseRenderOptions;

type Tracker = {
    id: string;
    name: string;
    min: number;
    max: number;
    value: number;
    mode: TrackerDisplayMode;
    stepMode: TrackerStepMode;
    skills: string[],
    pipImagePath?: string;
    visible?: boolean;
    step?: number;
    shiftMultiplier?: number;
};

type ContextTracker = Tracker & {
    ratio: number;
    increase: string;
    decrease: string;
};

type MenuTracker = Tracker & {
    delete?: boolean;
};

type TrackerSettings = BaseSettings & {
    worldTrackers: Tracker[];
    position: { left: number; top: number };
    extraSkills: string;
    showTracker: boolean;
};

export { PF2eHudTrackers };
