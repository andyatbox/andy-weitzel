"use client";

import type { ColumnsGroup } from "@/lib/portfolios";
import ProjectPortableText from "./ProjectPortableText";

export default function ProjectColumns({ groups }: { groups?: ColumnsGroup[] }) {
  if (!groups?.length) return null;

  return (
    <div className="my-12 space-y-16">
      {groups.map((group, i) => {
        const cols = [group.column1, group.column2];
        if (group.columns === "3") cols.push(group.column3);
        const three = group.columns === "3";
        return (
          <div
            key={i}
            className={
              three
                ? "grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-10"
                : "grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-10"
            }
          >
            {cols.map((col, j) => (
              <div
                key={j}
                className={three ? "" : "flex flex-col items-center justify-center p-6"}
              >
                <ProjectPortableText value={col} compact />
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
