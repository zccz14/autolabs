import type { Env } from './env';
import { fail } from './http';
import type { Principal } from './auth';
import { findProjectBySlug, projectRole, roleAtLeast, type ProjectRow, type Role } from './store';

export type Capability = 'read' | 'write' | 'verdict' | 'sota';

export interface Access {
  project: ProjectRow;
  role: Role;
  principal: Principal | null;
}

function tokenAllows(principal: Principal, capability: Capability): boolean {
  return principal.capabilities.includes('*') || principal.capabilities.includes(capability);
}

/**
 * 项目内的授权闸门：
 * - 人类身份走项目角色（owner/maintainer/runner/reader）；
 * - 机器凭据必须绑在本项目上，且具备对应能力；
 * - 公开只读项目对外来者降级为 reader。
 */
export async function loadProject(
  env: Env,
  slug: string,
  principal: Principal | null,
  neededRole: Role = 'reader',
  capability: Capability = 'read',
): Promise<Access> {
  const project = await findProjectBySlug(env, slug);
  if (!project) fail(404, 'not_found', `项目 ${slug} 不存在`);

  if (principal?.kind === 'token') {
    if (principal.projectId !== project.id) fail(403, 'forbidden', '凭据不属于该项目');
    if (!tokenAllows(principal, capability)) fail(403, 'forbidden', `凭据缺少 ${capability} 能力`);
    return { project, role: principal.capabilities.includes('sota') ? 'maintainer' : 'runner', principal };
  }

  const role = await projectRole(env, project, principal?.userId ?? null);
  if (!roleAtLeast(role, neededRole)) {
    if (!principal) fail(401, 'unauthorized', '需要登录');
    fail(403, 'forbidden', `需要 ${neededRole} 及以上角色`);
  }
  return { project, role: role as Role, principal };
}
