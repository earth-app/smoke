import { describe, expect, it } from 'vitest';
import {
	eventFor,
	getRuntime,
	importRoute,
	mockParams,
	seedAgent,
	seedLabel
} from '../../route-runtime';

describe('GET /api/labels/:id', () => {
	it('returns the label for any logged-in caller', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const label = await seedLabel(runtime, 'vip', '#112233');
		const handler = await importRoute('../../../../src/server/api/labels/[id]/index.get');

		mockParams({ id: label.id });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).resolves.toMatchObject({
			name: 'vip',
			color: '#112233'
		});
	});

	it('throws 404 when label does not exist', async () => {
		const runtime = getRuntime();
		const agent = await seedAgent(runtime);
		const handler = await importRoute('../../../../src/server/api/labels/[id]/index.get');

		mockParams({ id: 9999 });
		await expect(handler(eventFor(runtime.env, agent.sessionToken))).rejects.toMatchObject({
			statusCode: 404
		});
	});
});
