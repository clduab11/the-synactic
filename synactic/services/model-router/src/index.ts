// Model Router — provider abstraction + routing with envelope integration
export { ModelRouter, FakeModelProvider } from "./router.js";
export type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  RouterConfig,
  RouteRequestInput,
  RouteResult,
  RouteSuccess,
  RouteFailure,
  FakeModelProviderConfig,
} from "./router.js";

export { RouterError, RouterErrorCodes } from "./errors.js";
