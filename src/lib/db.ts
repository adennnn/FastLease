// In-memory store (persists during server runtime)
// Replace with a real DB later

export interface LeasingManager {
  id: string
  name: string
  email: string
  phone: string
  company: string
  calendarLink: string
  sheetLink: string
}

export interface Property {
  id: string
  managerId?: string
  address: string
  name: string
  type: string
  totalSqft: string
  yearBuilt: string
  images: string[]
  units: Unit[]
  createdAt: string
}

export interface Unit {
  id: string
  name: string
  sqft: string
  price: string
  type: string
  status: string
}

export interface Lead {
  id: string
  propertyId: string
  name: string
  email: string
  phone: string
  sqftNeeded: string
  budget: string
  tourBooked: boolean
  createdAt: string
}

// In-memory stores
const managers: Map<string, LeasingManager> = new Map()
const properties: Map<string, Property> = new Map()
const leads: Map<string, Lead> = new Map()

export const db = {
  managers: {
    create: (m: LeasingManager) => { managers.set(m.id, m); return m },
    get: (id: string) => managers.get(id),
    getAll: () => Array.from(managers.values()),
  },
  properties: {
    create: (p: Property) => { properties.set(p.id, p); return p },
    get: (id: string) => properties.get(id),
    getAll: () => Array.from(properties.values()),
    update: (id: string, data: Partial<Property>) => {
      const existing = properties.get(id)
      if (!existing) return null
      const updated = { ...existing, ...data }
      properties.set(id, updated)
      return updated
    },
  },
  leads: {
    create: (l: Lead) => { leads.set(l.id, l); return l },
    get: (id: string) => leads.get(id),
    getAll: () => Array.from(leads.values()),
    getByProperty: (propertyId: string) => Array.from(leads.values()).filter(l => l.propertyId === propertyId),
  },
}
