/**
 * lifeastroapi — official Node.js / TypeScript SDK for LifeAstroAPI.
 *
 * @packageDocumentation
 */
export { LifeAstro, VERSION } from "./client.js";
export type { LifeAstroOptions, ClientCore } from "./client.js";
export type { RequestOptions, FetchLike } from "./http.js";

export {
  LifeAstroError,
  LifeAstroConnectionError,
  BadRequestError,
  AuthenticationError,
  PaymentRequiredError,
  PermissionError,
  NotFoundError,
  RateLimitError,
  ServerError,
} from "./errors.js";
export type { ApiErrorBody } from "./errors.js";

export type {
  ResponseEnvelope,
  ResponseMeta,
  Ayanamsa,
  HouseSystem,
  Locale,
  BirthInput,
  MomentInput,
  BoyGirlInput,
  TwoPersonInput,
  RashiInput,
  NumerologyInput,
  DateRangeInput,
  WesternNatalInput,
  WesternMomentInput,
  MuhurtaInput,
  NatalTransitInput,
  VedicMomentSettings,
  VedicBirthSettings,
  QueryParams,
  QueryValue,
} from "./types.js";

// The LifeAstro class is also the default export for convenience.
import { LifeAstro } from "./client.js";
export default LifeAstro;
