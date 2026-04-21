export interface Unit {
  id: string; name: string; sqft: string; price: string; type: string; status: string
  term?: string; condition?: string; available?: string
}

export interface PropertyData {
  id: string; address: string; name: string; type: string; totalSqft: string
  yearBuilt: string; images: string[]; units: Unit[]; source?: string
  loopnetUrl?: string; message?: string; lat?: number; lon?: number
  highlights?: string[]; features?: Record<string, string>
  facilityFacts?: Record<string, string>; overview?: string
}

export interface Listing {
  id: string; propertyId: string; unitId: string
  title: string; description: string; price: string
  category: string; condition: string; location: string
  calendarLink: string; images: string[]
  createdAt: string
  facebookUrl?: string
  /** FB accounts this listing was posted from */
  postedBy?: Array<{ profileId: string; profileName: string }>
}
