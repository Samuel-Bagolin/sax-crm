import { Badge } from "@/components/ui/badge";
import { IMOVEL_STATUS } from "@/lib/constants";
import type { ImovelStatus } from "@/lib/types";

export function StatusImovelBadge({ status }: { status: ImovelStatus }) {
  const s = IMOVEL_STATUS[status];
  return (
    <Badge variant="outline" className={s.badge} data-testid={`imovel-status-badge-${status}`}>
      {s.label}
    </Badge>
  );
}
