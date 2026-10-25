import Image from "next/image";
import { Package } from "lucide-react";
import type { ProductImage as ProductImageData } from "@/server/catalog";
import { cn } from "@/lib/utils";

export function ProductImage({ image, sizes, className, priority }: {
  image: ProductImageData | null;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  if (!image) {
    return (
      <div className={cn("flex items-center justify-center bg-muted text-muted-foreground", className)}>
        <Package className="size-6" aria-hidden />
      </div>
    );
  }
  return (
    <Image
      src={image.url}
      alt={image.alt}
      fill
      sizes={sizes}
      priority={priority}
      unoptimized={image.url.endsWith(".svg")}
      className={cn("object-cover", className)}
    />
  );
}
