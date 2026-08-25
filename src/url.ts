import { Serialize } from "@ecosy/core/serialize";
import { flatten } from "@ecosy/core/utilities";

type Primitive = string | number | boolean | null | undefined;

type SearchParams = {
  [x: string]: Primitive | Primitive[] | SearchParams;
};

export interface UrlOptions {
  base?: string;
  pathname?: string;
  params?: Record<string, unknown>;
  search?: string | SearchParams;
}

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

  return Serialize.interpolate(url.toString(), options.params ?? {});
}
