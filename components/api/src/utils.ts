import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { z } from 'zod';

export function truthy<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

export function range(start: number, stop: number): number[] {
  const length = stop - start + 1;
  return Array.from({ length }, (_, i) => start + i);
}

export function wait(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function request(instance: AxiosInstance, config: AxiosRequestConfig): Promise<unknown>;
export async function request<I>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  schemas: { in: z.ZodType<I>; out: never },
): Promise<unknown>;
export async function request<O>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  schemas: { in: never; out: z.ZodType<O> },
): Promise<O>;
export async function request<I, O>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  schemas: { in: z.ZodType<I>; out: z.ZodType<O> },
): Promise<O>;
export async function request<I = unknown, O = unknown>(
  instance: AxiosInstance,
  config: AxiosRequestConfig,
  schemas?: { in?: z.ZodType<I>; out?: z.ZodType<O> },
): Promise<O | unknown> {
  if (schemas?.in) {
    config.data = schemas.in.parse(config.data);
  }
  const response = await instance.request<AxiosResponse<unknown>>(config).then((res) => res.data);
  return schemas?.out ? schemas.out.parse(response.data) : response.data;
}
