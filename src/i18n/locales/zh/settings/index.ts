// settings — Simplified Chinese UI strings
import appearance from "./appearance";
import enginesVendors from "./engines-vendors";
import services from "./services";
import workspaceBehavior from "./workspace-behavior";

const settings = {
  settings: {
    ...appearance.settings,
    ...enginesVendors.settings,
    ...services.settings,
    ...workspaceBehavior.settings,
  },
};

export default settings;
