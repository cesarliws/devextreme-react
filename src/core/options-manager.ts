import { ITemplateMeta } from "./template";

import { addPrefixToKeys, getNestedValue } from "./helpers";
import { createOptionComponent, INestedOptionMeta } from "./nested-option";
import { getTemplateOptions } from "./template-helper";
import { separateProps } from "./widget-config";

interface INestedOption {
    optionName: string;
    isCollectionItem: boolean;
}

interface INestedConfigDescr extends INestedOption {
    defaults: Record<string, any>;
    templates: ITemplateMeta[];
    elementEntries: Array<{
        element: React.ReactElement<any>;
        children: Record<string, INestedConfigDescr>;
        predefinedProps: Record<string, any>;
    }>;
}

interface INestedConfigClass {
    type: {
        IsCollectionItem: boolean;
        OptionName: string;
        DefaultsProps: Record<string, string>;
        TemplateProps: ITemplateMeta[];
        PredefinedProps: Record<string, any>;
        ExpectedChildren: Record<string, INestedOption>;
    };
    props: object;
}

function isEventHanlder(optionName: string, optionValue: any) {
    return optionName.substr(0, 2) === "on" && typeof optionValue === "function";
}

class OptionsManager {

    private readonly _guards: Record<string, number> = {};
    private readonly _nestedOptions: Record<string, INestedConfigDescr> = {};
    private readonly _optionValueGetter: (name: string) => any;

    private _instance: any;

    private _updatingProps: boolean;

    constructor(optionValueGetter: (name: string) => any) {
        this._optionValueGetter = optionValueGetter;
        this._setOption = this._setOption.bind(this);
        this._registerNestedOption = this._registerNestedOption.bind(this);

        this.registerNestedOption = this.registerNestedOption.bind(this);
        this.handleOptionChange = this.handleOptionChange.bind(this);
        this.processChangedValues = this.processChangedValues.bind(this);
    }

    public resetNestedElements() {
        Object.keys(this._nestedOptions).forEach((optionName) => {
            this._nestedOptions[optionName].elementEntries.length = 0;
        });
    }

    public setInstance(instance: any) {
        this._instance = instance;
    }

    public wrapEventHandlers(options: Record<string, any>) {
        Object.keys(options).forEach((name) => {
            const value = options[name];
            if (isEventHanlder(name, value)) {
                options[name] = this._wrapEventHandler(value);
            }
        });
    }

    public handleOptionChange(e: { name: string, fullName: string, value: any }) {
        if (this._updatingProps) {
            return;
        }

        let optionValue;

        const nestedOption = this._nestedOptions[e.name];
        if (nestedOption) {
            const nestedOptionObj = separateProps(
                nestedOption.elementEntries[0].element.props,
                nestedOption.defaults,
                []
            ).options;

            if (e.name === e.fullName) {
                Object.keys(nestedOptionObj).forEach((key) => this.handleOptionChange({
                    name: e.name,
                    fullName: `${e.fullName}.${key}`,
                    value: e.value[key]
                }));

                return;
            }

            if (!nestedOption.isCollectionItem) {
                optionValue = getNestedValue(nestedOptionObj, e.fullName.split(".").slice(1));
            }
        } else {
            optionValue = this._optionValueGetter(e.name);
        }

        if (optionValue === undefined || optionValue === null) {
            return;
        }

        this._setGuard(e.fullName, optionValue);
    }

    public processChangedValues(newProps: Record<string, any>, prevProps: Record<string, any>): void {
        this._updatingProps = false;

        for (const optionName of Object.keys(newProps)) {
            if (newProps[optionName] === prevProps[optionName]) {
                continue;
            }

            if (this._guards[optionName]) {
                window.clearTimeout(this._guards[optionName]);
                delete this._guards[optionName];
            }

            if (!this._updatingProps) {
                this._instance.beginUpdate();
                this._updatingProps = true;
            }
            this._setOption(optionName, newProps[optionName]);
        }

        if (this._updatingProps) {
            this._updatingProps = false;
            this._instance.endUpdate();
        }
    }

    public getNestedOptionsObjects(stateUpdater: any): Record<string, any> {
        return this._getNestedOptionsObjects(this._nestedOptions, stateUpdater);
    }

    public registerNestedOption(
        component: React.ReactElement<any>,
        expectedChildren: Record<string, INestedOption>
    ): any {
        return this._registerNestedOption(component, expectedChildren, this._nestedOptions);
    }

    private _setOption(name: string, value: any): void {
        let actualValue = value;
        if (isEventHanlder(name, value)) {
            actualValue = this._wrapEventHandler(value);
        }
        this._instance.option(name, actualValue);
    }

    private _wrapEventHandler(handler: any) {
        return (...args: any[]) => {
            if (!this._updatingProps) {
                handler(...args);
            }
        };
    }

    private _getNestedOptionsObjects(
        optionsCollection: Record<string, INestedConfigDescr>,
        stateUpdater: any
    ): Record<string, any> {
        const configComponents: Record<string, any> = {};

        let templates = {};
        Object.keys(optionsCollection).forEach((key) => {
            const configComponent = optionsCollection[key];
            const options = configComponent.elementEntries.map((e, index) => {
                const props = separateProps(e.element.props,
                    configComponent.defaults,
                    configComponent.templates);
                const templateOptions = getTemplateOptions({
                    options: props.templates,
                    nestedOptions: {},
                    templateProps: configComponent.templates,
                    ownerName: `${configComponent.optionName}${configComponent.isCollectionItem ? `[${index}]` : ""}`,
                    stateUpdater,
                    propsGetter: (prop) => configComponent.elementEntries[index].element.props[prop]
                });

                templates = {
                    ...templates,
                    ...templateOptions.templates
                };

                return {
                    ...e.predefinedProps,
                    ...props.defaults,
                    ...props.options,
                    ...templateOptions.templateStubs,
                    ...this._getNestedOptionsObjects(e.children, stateUpdater)
                };
            });
            configComponents[configComponent.optionName] = configComponent.isCollectionItem
                ? options
                : options[options.length - 1];
        });

        if (Object.keys(templates).length) {
            configComponents.integrationOptions = {
                templates
            };
        }

        return configComponents;
    }

    private _registerNestedOption(
        element: React.ReactElement<any>,
        expectedChildren: Record<string, INestedOption>,
        owningCollection: Record<string, INestedConfigDescr>,
        ownerFullName?: string
    ): any {
        const nestedOptionClass = element as any as INestedConfigClass;
        if (!(nestedOptionClass && nestedOptionClass.type && nestedOptionClass.type.OptionName)) {
            return null;
        }

        const nestedOptionsCollection: Record<string, INestedConfigDescr> = {};

        const resolvedNested = resolveNestedOption(
            nestedOptionClass.type.OptionName,
            nestedOptionClass.type.IsCollectionItem,
            expectedChildren
        );
        const optionName = resolvedNested.optionName;
        const isCollectionItem = resolvedNested.isCollectionItem;

        const entry = ensureNestedOption(
            optionName,
            owningCollection,
            nestedOptionClass.type.DefaultsProps,
            nestedOptionClass.type.TemplateProps,
            isCollectionItem
        );

        const index = isCollectionItem ? `[${entry.elementEntries.length}]` : "";
        let optionFullName = `${optionName}${index}`;
        if (ownerFullName) {
            optionFullName = `${ownerFullName}.${optionFullName}`;
        }

        const nestedOptionMeta: INestedOptionMeta = {
            optionName,
            registerNestedOption: (c: React.ReactElement<any>) => {
                return this._registerNestedOption(
                    c,
                    nestedOptionClass.type.ExpectedChildren,
                    nestedOptionsCollection,
                    optionFullName
                );
            },
            updateFunc: (newProps, prevProps) => {
                const newOptions = separateProps(newProps,
                    nestedOptionClass.type.DefaultsProps,
                    nestedOptionClass.type.TemplateProps).options;
                this.processChangedValues(
                    addPrefixToKeys(newOptions, optionFullName + "."),
                    addPrefixToKeys(prevProps, optionFullName + ".")
                );
            }
        };

        const optionComponent = createOptionComponent(element, nestedOptionMeta);

        entry.elementEntries.push({
            element,
            children: nestedOptionsCollection,
            predefinedProps: nestedOptionClass.type.PredefinedProps
        });

        return optionComponent;
    }

    private _setGuard(optionName: string, optionValue: any): void {
        if (this._guards[optionName] !== undefined) {
            return;
        }

        const guardId = window.setTimeout(() => {
            this._setOption(optionName, optionValue);
            window.clearTimeout(guardId);
            delete this._guards[optionName];
        });

        this._guards[optionName] = guardId;
    }
}

function ensureNestedOption(
    optionName: string,
    optionsCollection: Record<string, INestedConfigDescr>,
    defaults: Record<string, any>,
    templates: ITemplateMeta[],
    isCollectionItem: boolean
): INestedConfigDescr {

    if (optionsCollection[optionName] === null ||
        optionsCollection[optionName] === undefined
    ) {
        optionsCollection[optionName] = {
            optionName,
            defaults,
            templates,
            elementEntries: [],
            isCollectionItem
        };
    }

    return optionsCollection[optionName];
}

function resolveNestedOption(
    componentName: string,
    canBeCollectionItem: boolean,
    expectations: Record<string, INestedOption>
): INestedOption {
    let optionName = componentName;
    let isCollectionItem = canBeCollectionItem;

    const expectation = expectations && expectations[componentName];
    if (expectation) {
        isCollectionItem = expectation.isCollectionItem;
        if (expectation.optionName) {
            optionName = expectation.optionName;
        }
    }

    return { optionName, isCollectionItem };
}

export default OptionsManager;
export {
    INestedOption,
    resolveNestedOption
};
