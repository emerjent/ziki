import type { Metadata } from "next";

import { LoadError } from "@/components/load-error";
import { SecuritySettings } from "@/components/security/security-settings";
import { requireUser } from "@/lib/auth-helpers";
import { logLoadFailure } from "@/lib/load-error";
import { currentOrganisationAccess, type OrganisationAccess } from "@/lib/organisation-access";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  let access: OrganisationAccess;
  try {
    access = await currentOrganisationAccess(user.id, user.role);
  } catch (error) {
    return (
      <LoadError
        title="Security settings could not be loaded"
        reference={logLoadFailure("[security settings] access lookup failed", error)}
      />
    );
  }

  return (
    <SecuritySettings
      isAdmin={access.admin}
      hasWorkspace={Boolean(access.organisationId)}
    />
  );
}
