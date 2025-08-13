// src/types/plu.types.ts
export interface AddressData {
  label: string;
  score: number;
  housenumber?: string;
  street?: string;
  postcode: string;
  city: string;
  context: string;
  type: string;
  importance: number;
  x: number;
  y: number;
}

export interface ParcelData {
  id: string;
  commune: string;
  prefixe: string;
  section: string;
  numero: string;
  contenance: number;
  geometry: {
    type: string;
    coordinates: number[][][];
  };
}

export interface ZoneUrbaData {
  libelle: string;
  libelong: string;
  typezone: string;
  destdomi: string;
  nomfic: string;
  urlfic: string;
  datappro: string;
  datevalid: string;
}

export interface SupData {
  categorie: string;
  libelle: string;
  libelong: string;
  nomfic: string;
  urlfic: string;
}

export interface PLUAnalysisResult {
  address: AddressData;
  parcel: ParcelData;
  zone: ZoneUrbaData;
  servitudes: SupData[];
  restrictions: string[];
  rights: string[];
  documents: Array<{
    name: string;
    url: string;
    type: 'reglement' | 'zonage' | 'oap';
  }>;
}