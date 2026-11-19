import Link from "next/link";
import type { PermissionView } from "@/components/role-manager-model";

interface Group {
  readonly page: string;
  readonly label: string;
  readonly permissions: readonly (PermissionView & { value: string; label: string })[];
}

/** Read-only: every permission with the roles that hold it and who holds those roles now. */
export function RolePermissions({ groups }: { groups: readonly Group[] }) {
  return (
    <div className="admin-role-manager">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title admin-role-title">
            <Link href="/roles/edit">Edit Role</Link>
            <span aria-hidden="true"> &gt; </span>
            By permission
          </h1>
          <p className="admin-page-header__desc">
            Who can do what, today. Revoked roles, other periods and inactive accounts are not
            counted.
          </p>
        </div>
      </div>
      {groups.map((group) => (
        <section key={group.page} className="admin-card">
          <h2 className="admin-card__title">{group.label}</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Roles</th>
                <th>People</th>
              </tr>
            </thead>
            <tbody>
              {group.permissions.map((p) => (
                <tr key={p.value}>
                  <td>{p.label}</td>
                  <td>{p.roles.map((r) => r.name).join(", ") || "—"}</td>
                  <td>
                    {p.holders && p.count > 0 ? (
                      <details>
                        <summary>{p.count}</summary>
                        <ul>
                          {p.holders.map((h) => (
                            <li key={h.uid}>
                              {h.name} <span className="admin-table__sub">{h.scope}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      p.count
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
