import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const data = await req.json()
  const lead = db.leads.create({
    id: Date.now().toString(),
    propertyId: data.propertyId || '',
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    sqftNeeded: data.sqftNeeded || '',
    budget: data.budget || '',
    tourBooked: false,
    createdAt: new Date().toISOString(),
  })
  return NextResponse.json(lead)
}

export async function GET() {
  return NextResponse.json(db.leads.getAll())
}
