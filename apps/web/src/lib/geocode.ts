/** API Adresse (data.gouv.fr) : gratuite, sans clé. Une seule saisie → adresse, CP, ville et coordonnées. */
export async function geocode(q: string) {
  const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`);
  const f = (await res.json()).features?.[0];
  if (!f) throw new Error('ADDRESS_NOT_FOUND');
  const [lng, lat] = f.geometry.coordinates as [number, number];
  const p = f.properties as { name: string; postcode: string; city: string };
  return { address: p.name, postalCode: p.postcode, city: p.city, location: { lat, lng } };
}
