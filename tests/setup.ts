import { beforeEach, vi } from 'vitest';

type AnyFn = (...args: any[]) => any;

const createHttpError: AnyFn = (input: {
	statusCode?: number;
	message?: string;
	data?: unknown;
	stack?: string;
}) => {
	const error = new Error(input?.message || 'Request failed') as Error & {
		statusCode?: number;
		data?: unknown;
	};
	error.statusCode = input?.statusCode ?? 500;
	if (input?.data !== undefined) {
		error.data = input.data;
	}
	if (input?.stack) {
		error.stack = input.stack;
	}
	return error;
};

(globalThis as Record<string, unknown>).defineEventHandler = ((handler: AnyFn) => handler) as AnyFn;
(globalThis as Record<string, unknown>).defineNitroPlugin = ((plugin: AnyFn) => plugin) as AnyFn;
(globalThis as Record<string, unknown>).createError = createHttpError;
(globalThis as Record<string, unknown>).sendNoContent = vi.fn(() => null);
(globalThis as Record<string, unknown>).readValidatedBody = vi.fn();
(globalThis as Record<string, unknown>).getValidatedRouterParams = vi.fn();
(globalThis as Record<string, unknown>).readValidatedRouterParams = vi.fn();
(globalThis as Record<string, unknown>).getQuery = vi.fn(() => ({}));
(globalThis as Record<string, unknown>).getCookie = vi.fn(() => null);
(globalThis as Record<string, unknown>).setCookie = vi.fn();
(globalThis as Record<string, unknown>).getHeader = vi.fn(() => undefined);
(globalThis as Record<string, unknown>).readMultipartFormData = vi.fn();
(globalThis as Record<string, unknown>).isError = ((error: unknown) =>
	Boolean(error && typeof error === 'object' && 'statusCode' in error)) as AnyFn;
(globalThis as Record<string, unknown>).sendRedirect = vi.fn();
(globalThis as Record<string, unknown>).sendStream = vi.fn();

beforeEach(() => {
	vi.clearAllMocks();
	// clearAllMocks keeps return values; reset header/multipart mocks so a
	// per-test content-type override doesn't leak into later tests
	((globalThis as Record<string, unknown>).getHeader as ReturnType<typeof vi.fn>).mockReturnValue(
		undefined
	);
	(
		(globalThis as Record<string, unknown>).readMultipartFormData as ReturnType<typeof vi.fn>
	).mockReset();
});
