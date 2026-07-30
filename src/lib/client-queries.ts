import type { PrismaClient } from "@prisma/client";
import { clientInitials, type ClientStatus } from "@/lib/client";
import { isProjectActive, type ProjectStatus } from "@/lib/project";
import { listProjects, type ProjectListRow } from "@/lib/project-queries";

export type ClientListRow = {
  id: string;
  name: string;
  initials: string;
  status: ClientStatus;
  sector: string | null;
  projectCount: number;
  primaryContact: { name: string; email: string | null } | null;
};

export async function listClients(db: PrismaClient): Promise<ClientListRow[]> {
  const clients = await db.client.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      status: true,
      sector: true,
      contacts: { select: { name: true, email: true, isPrimary: true } },
      projects: { select: { status: true } },
    },
  });

  return clients.map((c) => {
    const primary = c.contacts.find((contact) => contact.isPrimary);
    return {
      id: c.id,
      name: c.name,
      initials: clientInitials(c.name),
      status: c.status as ClientStatus,
      sector: c.sector,
      projectCount: c.projects.filter((p) => isProjectActive(p.status as ProjectStatus)).length,
      primaryContact: primary ? { name: primary.name, email: primary.email } : null,
    };
  });
}

export type ClientDetail = {
  id: string;
  name: string;
  initials: string;
  status: ClientStatus;
  sector: string | null;
  website: string | null;
  notes: string | null;
  engagementType: string | null;
  clientSince: Date | null;
  accountLead: { id: string; name: string } | null;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string | null;
    isPrimary: boolean;
  }>;
  projects: ProjectListRow[];
};

export async function getClientDetail(
  db: PrismaClient,
  clientId: string
): Promise<ClientDetail | null> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      name: true,
      status: true,
      sector: true,
      website: true,
      notes: true,
      engagementType: true,
      clientSince: true,
      accountLead: { select: { id: true, name: true } },
      contacts: {
        select: { id: true, name: true, email: true, phone: true, role: true, isPrimary: true },
      },
    },
  });
  if (!client) return null;

  const contacts = [...client.contacts].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Reuses the list read model so a project's progress is computed the same
  // way here as it is on /projects.
  const projects = await listProjects(db, { clientId });

  return {
    id: client.id,
    name: client.name,
    initials: clientInitials(client.name),
    status: client.status as ClientStatus,
    sector: client.sector,
    website: client.website,
    notes: client.notes,
    engagementType: client.engagementType,
    clientSince: client.clientSince,
    accountLead: client.accountLead,
    contacts,
    projects,
  };
}
