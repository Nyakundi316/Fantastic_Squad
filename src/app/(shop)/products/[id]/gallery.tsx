"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProductImage } from "@/server/catalog";
import { cn } from "@/lib/utils";

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const [active, setActive] = useState(0);
  const current = images[active];

  return (
    <div className="flex flex-col gap-3 sm:flex-row-reverse">
      <div className="relative aspect-square flex-1 overflow-hidden rounded-xl border border-border bg-surface">
        {current ? (
          <Image
            key={current.url}
            src={current.url}
            alt={current.alt || title}
            fill
            priority
            sizes="(min-width: 1024px) 50vw, 100vw"
            unoptimized={current.url.endsWith(".svg")}
            className="animate-in fade-in object-cover duration-200"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No photo yet</div>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-2 sm:w-16 sm:flex-col" role="tablist" aria-label="Product photos">
          {images.map((image, i) => (
            <button
              key={image.url}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={image.alt || `Photo ${i + 1}`}
              onClick={() => setActive(i)}
              className={cn(
                "relative size-16 overflow-hidden rounded-lg border bg-surface transition",
                i === active ? "border-primary ring-2 ring-primary/20" : "border-border opacity-80 hover:opacity-100",
              )}
            >
              <Image src={image.url} alt="" fill sizes="64px" unoptimized={image.url.endsWith(".svg")} className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
