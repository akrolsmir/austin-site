import Image from "next/image";
import { formatMonth, photos } from "@/lib/photos";
import { E } from "@/site/e";

export const metadata = { title: "photos" };
export default function Photos() {
  return <main id="content" className="archive photo-album"><E id="photos.heading" as="h1" /><ul className="photo-grid">{photos.map((photo, i) => <li key={photo.url}><figure><Image src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} sizes="(max-width: 760px) 100vw, 400px" priority={i < 2} /><figcaption>{formatMonth(photo.date)}</figcaption></figure></li>)}</ul></main>;
}
