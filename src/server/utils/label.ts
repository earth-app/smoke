import { allAllShardsGlobal, first, run } from '@earth-app/collegedb';
import { DBLabel } from 'hub:db:schema';

export async function createLabel(name: string, color?: string): Promise<Label> {
	const maxRow = await first<{ id: number }>(
		'labels',
		`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM labels`,
		[]
	);
	const nextId = Number(maxRow?.id ?? 1);
	const nowSeconds = Math.floor(Date.now() / 1000);

	await run(
		String(nextId),
		`INSERT INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)`,
		[nextId, name, color ?? null, nowSeconds]
	);

	const label = await getLabelById(nextId);
	if (!label) {
		throw createError({
			statusCode: 500,
			message: 'Failed to create label'
		});
	}

	return { ...label, color: label.color || undefined };
}

export async function getLabelById(id: number): Promise<Label | null> {
	const label = await first<DBLabel>(
		String(id),
		`SELECT id, name, color FROM labels WHERE id = ?`,
		[id]
	);

	if (!label) {
		return null;
	}

	return { ...label, color: label.color || undefined };
}

export async function listLabels(): Promise<Label[]> {
	const labels = await allAllShardsGlobal<DBLabel>(`SELECT id, name, color FROM labels`, []).then(
		(r) => r.results
	);
	return labels.map((label) => ({ ...label, color: label.color || undefined }));
}

export async function patchLabel(id: number, updates: Partial<Omit<Label, 'id'>>): Promise<Label> {
	const fields = [];
	const bindings = [];
	if (updates.name) {
		fields.push('name = ?');
		bindings.push(updates.name);
	}
	if (updates.color !== undefined) {
		fields.push('color = ?');
		bindings.push(updates.color || null);
	}

	if (fields.length === 0) {
		throw createError({
			statusCode: 400,
			message: 'No valid fields to update'
		});
	}

	bindings.push(id);
	const id0 = String(id);
	await run(id0, `UPDATE labels SET ${fields.join(', ')} WHERE id = ?`, bindings);

	const updated = await first<DBLabel>(id0, `SELECT id, name, color FROM labels WHERE id = ?`, [
		id
	]);

	if (!updated) {
		throw createError({
			statusCode: 404,
			message: 'Label not found after update'
		});
	}

	return { ...updated, color: updated.color || undefined };
}

export async function deleteLabel(id: number): Promise<void> {
	await run(String(id), `DELETE FROM labels WHERE id = ?`, [id]);
}
