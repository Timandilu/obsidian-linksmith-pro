function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSettings<T extends object>(
	stored: unknown,
	defaults: T,
): T {
	const settings = { ...defaults };
	const data = isRecord(stored) ? stored : {};
	for (const key of Object.keys(defaults) as Array<keyof T>) {
		const fallback = defaults[key];
		const value = data[String(key)];
		if (Array.isArray(fallback)) {
			settings[key] = (
				Array.isArray(value)
					? value.filter(
							(item: unknown): item is string =>
								typeof item === 'string',
						)
					: [...fallback]
			) as T[typeof key];
		} else if (
			typeof value === typeof fallback &&
			(typeof value !== 'number' || Number.isFinite(value))
		) {
			settings[key] = value as T[typeof key];
		}
	}
	return settings;
}
