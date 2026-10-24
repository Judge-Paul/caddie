import type {
  CvAnchor,
  CvBullet,
  CvClassification,
  CvProject,
  CvRole,
} from './cv-classification'

export type CvMapTargetKind = 'role-bullet' | 'project-bullet' | 'project-description'

export type CvMapTarget = {
  id: string
  kind: CvMapTargetKind
  text: string
  blockId: string | null
  wholeBlock: boolean
  roleId: string | null
  projectId: string | null
  label: string
}

export type CvMapProject = Omit<CvProject, 'bullets'> & {
  bullets: CvMapTarget[]
  descriptionTarget: CvMapTarget | null
}

export type CvMapRole = Omit<CvRole, 'bullets'> & {
  bullets: CvMapTarget[]
  projects: CvMapProject[]
}

export type CvMap = {
  roles: CvMapRole[]
  orphanProjects: CvMapProject[]
  skills: string[]
}

function targetFromBullet(
  bullet: CvBullet,
  input: {
    id: string
    kind: CvMapTargetKind
    roleId: string | null
    projectId: string | null
    label: string
  },
): CvMapTarget {
  const anchor: CvAnchor | null = bullet.anchor
  return {
    id: input.id,
    kind: input.kind,
    text: bullet.text,
    blockId: anchor?.blockId ?? null,
    wholeBlock: Boolean(anchor && !anchor.find),
    roleId: input.roleId,
    projectId: input.projectId,
    label: input.label,
  }
}

function projectFrom(project: CvProject, roleId: string | null): CvMapProject {
  const projectId = project.id
  const bullets = project.bullets.map((bullet, index) =>
    targetFromBullet(bullet, {
      id: `${projectId}:bullet:${index}`,
      kind: 'project-bullet',
      roleId,
      projectId,
      label: project.name || 'Project bullet',
    }),
  )

  const description = project.description
  const descriptionAnchor = project.anchors.description
  const descriptionTarget =
    description && descriptionAnchor?.blockId
      ? {
          id: `${projectId}:description`,
          kind: 'project-description' as const,
          text: description,
          blockId: descriptionAnchor.blockId,
          wholeBlock: !descriptionAnchor.find,
          roleId,
          projectId,
          label: project.name || 'Project description',
        }
      : null

  return { ...project, roleId, bullets, descriptionTarget }
}

export function buildCvMap(cv: CvClassification): CvMap {
  const projectsByRole = new Map<string, CvProject[]>()
  const orphanProjects: CvProject[] = []

  for (const project of cv.projects) {
    const role = project.roleId
      ? cv.roles.find((entry) => entry.id === project.roleId)
      : null
    if (role) {
      projectsByRole.set(role.id, [...(projectsByRole.get(role.id) ?? []), project])
    } else {
      orphanProjects.push(project)
    }
  }

  const roles = cv.roles.map((role) => {
    const targets = role.bullets.map((bullet, index) =>
      targetFromBullet(bullet, {
        id: `${role.id}:bullet:${index}`,
        kind: 'role-bullet',
        roleId: role.id,
        projectId: null,
        label: [role.title, role.company].filter(Boolean).join(' · ') || 'Role bullet',
      }),
    )

    return {
      ...role,
      bullets: targets,
      projects: (projectsByRole.get(role.id) ?? []).map((project) =>
        projectFrom(project, role.id),
      ),
    }
  })

  return {
    roles,
    orphanProjects: orphanProjects.map((project) => projectFrom(project, null)),
    skills: cv.skills,
  }
}

export function cvMapTargets(map: CvMap): CvMapTarget[] {
  const targets: CvMapTarget[] = []

  for (const role of map.roles) {
    targets.push(...role.bullets)
    for (const project of role.projects) {
      if (project.descriptionTarget) targets.push(project.descriptionTarget)
      targets.push(...project.bullets)
    }
  }

  for (const project of map.orphanProjects) {
    if (project.descriptionTarget) targets.push(project.descriptionTarget)
    targets.push(...project.bullets)
  }

  return targets.filter((target) => Boolean(target.blockId))
}
