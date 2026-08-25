import {
  HttpStatic,
  Methods,
  type HttpMethod,
  type HttpInit,
  type HttpInterceptorError,
  type HttpInterceptorRequest,
  type HttpInterceptorResponse,
  type HttpInterceptorTransform,
} from "@ecosy/core/http";
import { createUrl } from "./url";

export interface FetcherOptions extends Omit<HttpInit, "url" | "method" | "interceptors" | "query"> {
  url: string;
  method?: HttpMethod;
  search?: Record<string, string | number | boolean | null | undefined>;
  params?: Record<string, unknown>;
  transform?: HttpInterceptorTransform;
  request?: HttpInterceptorRequest;
  response?: HttpInterceptorResponse;
  error?: HttpInterceptorError;
}

export abstract class HttpRequest {
  protected abstract request<DataType = unknown, Err = unknown>(options: FetcherOptions): Promise<any>;

  public normalize = <DataType = unknown, Err = unknown>(
    options: string | Omit<FetcherOptions, "method">,
    method: HttpMethod,
  ) => {
    let opt = {
      method,
    } as FetcherOptions;

    if (typeof options === "string") {
      opt.url = options;
    } else {
      opt = Object.assign(opt, options);
    }

    return this.request<DataType, Err>(opt);
  };

  public readonly get = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.GET);
  };

  public readonly post = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.POST);
  };

  public readonly put = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.PUT);
  };

  public readonly patch = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.PATCH);
  };

  public readonly options = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.OPTIONS);
  };

  public readonly head = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.HEAD);
  };

  public readonly delete = <DataType = unknown, Err = unknown>(options: string | Omit<FetcherOptions, "method">) => {
    return this.normalize<DataType, Err>(options, Methods.DELETE);
  };
}

class NextFetcher extends HttpRequest {
  public METHOD = Methods;

  public request = async <DataType = unknown, Err = unknown>(options: FetcherOptions) => {
    const { url, search, params, ...initOptions } = options;

    const finalUrl = createUrl({
      base: url,
      search: search,
      params: params || {},
    });

    return HttpStatic.request<DataType, Err>({
      ...initOptions,
      url: finalUrl,
      method: options.method || Methods.GET,
    } as HttpInit);
  };

  // Allow fetcher to be called directly like runFetcher
  public call = <DataType = unknown, Err = unknown>(options: FetcherOptions) => {
    return this.request<DataType, Err>(options);
  };
}

export const fetcher = new NextFetcher();
