import { flatten } from "./utils/flatten";
import { get } from "./utils/get";

/**
 * Replaces `{name}` placeholders with values looked up by path.
 *
 * A value that is missing, `null` or an object becomes an empty string, so an
 * unresolved placeholder disappears rather than surviving as literal braces.
 *
 * @param pattern - The string to interpolate. Returned unchanged when it holds no braces.
 * @param params - Values to look up, by dot path.
 * @returns The interpolated string.
 */
function interpolate(
  pattern: string,
  params: Record<string, unknown> | Array<unknown> = {},
): string {
  if (
    !pattern ||
    typeof pattern !== "string" ||
    !pattern.trim().length ||
    !pattern.includes("{") ||
    !pattern.includes("}")
  ) {
    return pattern;
  }

  return pattern.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, variable) => {
    const value = get(params, variable);
    if (value === null || value === undefined || typeof value === "object") {
      return "";
    }
    return String(value);
  });
}
/** A leaf value in a query string. */
type Primitive = string | number | boolean | null | undefined;

/** A nestable query-string object; nesting is flattened to dot-separated keys. */
type SearchParams = {
  [x: string]: Primitive | Primitive[] | SearchParams;
};

/** Options for {@link createUrl}. */
export interface UrlOptions {
  base?: string;
  pathname?: string;
  params?: Record<string, unknown>;
  search?: string | SearchParams;
}

/**
 * Renders a leaf value as a query-string value: `null` becomes `""`, booleans
 * become `"true"` / `"false"`, and `undefined` stays `undefined`.
 *
 * @param value - The leaf to render.
 */
function normalize(value: Primitive): string | undefined {
  let result = String(value);

  if (value === undefined) {
    return value;
  }

  if (value === null) {
    result = "";
  }

  if (typeof value === "boolean") {
    result = value ? "true" : "false";
  }

  return result;
}

/**
 * Flattens a nested search object to one level.
 *
 * Note that the returned keys are **dot-separated** (`filter.active`,
 * `tags.0`). The bracket-notation branch below builds an accumulator that is
 * never returned, so it has no effect on the result — and neither does the
 * `undefined` check inside it, which is why `undefined` leaves survive into
 * {@link createUrl}.
 *
 * @param search - The nested search object.
 * @returns The flattened object, keyed by dot path.
 */
function flattenSearchParams(search: SearchParams) {
  const flattened = flatten(search);
  Object.entries(flattened).reduce((acc, [key, value]) => {
    if (value === undefined) {
      return acc;
    }

    const arr = key.split(".");

    if (arr.length === 2) {
      key = key.replace(".", "[") + "]";
    }
    else if (arr.length > 2) {
      key = arr.reduce((a, p, i) => {
        if (i === 0) {
          a = a + p;
        } else if (i === 1) {
          a = a + "[" + p;
        } else {
          a = a + "][" + p;
        }
        return a;
      }, "") + "]";
    }

    acc[key] = normalize(value as Primitive) as string;
    return acc;
  }, {} as Record<string, string>);

  return flattened;
}

/**
 * Builds a URL from a base, a path, a query and placeholder values.
 *
 * @example
 * createUrl({
 *   base: "https://example.com",
 *   pathname: "/users/42",
 *   search: { page: 2, filter: { active: true }, tags: ["a", "b"] },
 * });
 * // https://example.com/users/42?page=2&filter.active=true&tags.0=a&tags.1=b
 *
 * An object `search` is flattened to dot-separated keys, not bracket keys —
 * pass a string when another format is needed. Leaf values are stringified by
 * `URLSearchParams`, so `null` and `undefined` become the literal `"null"` and
 * `"undefined"` rather than being dropped; filter them out beforehand.
 *
 * `params` fills `{name}` placeholders in the **finished** URL. Braces survive
 * in a query string but are percent-encoded in a path, so a placeholder in
 * `pathname` is never substituted — interpolate path segments yourself.
 *
 * @param options - Base, path, query and placeholder values. `base` is optional
 * in the type but required in practice: without it the `URL` constructor throws.
 * @returns The finished URL.
 */
export function createUrl(options: UrlOptions) {
  const url = new URL(options.base ?? "");

  if (options.pathname) {
    url.pathname = options.pathname;
  }

  if (options.search) {
    if (typeof options.search === "string") {
      url.search = options.search;
    } else {

      Object.entries(flattenSearchParams(options.search)).forEach(([key, value]) => {
        url.searchParams.set(key, value as string);
      });
    }
  }

  return interpolate(url.toString(), options.params ?? {});
}
