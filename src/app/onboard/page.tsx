'use client'

import { useState } from 'react'

const STEPS = ['Personal Info', 'Property Details', 'Images', 'Integrations', 'Review']

export default function OnboardPage() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '',
    propertyAddress: '', propertyName: '', propertyType: 'Office',
    calendarLink: '', sheetLink: '',
  })
  const [images, setImages] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)

  const update = (field: string, value: string) => setForm({ ...form, [field]: value })

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = () => {
        setImages(prev => [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleSubmit = async () => {
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          propertyId: 'onboard',
          sqftNeeded: '',
          budget: '',
        }),
      })
      setSubmitted(true)
    } catch { setSubmitted(true) }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-white dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">✓</div>
          <h1 className="text-3xl font-extrabold mb-2 text-black dark:text-zinc-50">You're All Set</h1>
          <p className="text-gray-600 dark:text-zinc-400 mb-6">Your property has been onboarded. We'll start generating listings and qualifying leads.</p>
          <a href="/dashboard" className="px-6 py-3 bg-black dark:bg-white text-white dark:text-black font-bold hover:bg-gray-900 dark:hover:bg-zinc-200 transition inline-block">
            Go to Dashboard
          </a>
        </div>
      </div>
    )
  }

  const inputClasses = "w-full border-2 border-black dark:border-zinc-600 bg-white dark:bg-zinc-900 text-black dark:text-zinc-50 px-4 py-3 outline-none placeholder:text-gray-400 dark:placeholder:text-zinc-500"

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Nav */}
      <nav className="border-b border-gray-200 dark:border-zinc-800 px-8 py-4 flex items-center justify-between">
        <a href="/" className="text-2xl font-extrabold tracking-tight text-black dark:text-zinc-50">Leasely</a>
        <a href="/dashboard" className="px-5 py-2 border border-black dark:border-zinc-600 font-semibold text-black dark:text-zinc-50 hover:bg-gray-50 dark:hover:bg-zinc-800">Dashboard</a>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Step Indicator */}
        <div className="flex mb-12">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 text-center">
              <div className={`w-8 h-8 mx-auto flex items-center justify-center text-sm font-bold border-2 ${
                i <= step ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white' : 'border-gray-300 dark:border-zinc-600 text-gray-400 dark:text-zinc-500'
              }`}>
                {i + 1}
              </div>
              <div className={`text-xs mt-1 font-semibold ${i <= step ? 'text-black dark:text-zinc-50' : 'text-gray-400 dark:text-zinc-500'}`}>
                {s}
              </div>
            </div>
          ))}
        </div>

        {/* Step 1: Personal Info */}
        {step === 0 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-6 text-black dark:text-zinc-50">Personal Information</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Full Name</label>
                <input value={form.name} onChange={e => update('name', e.target.value)}
                  className={inputClasses} placeholder="John Smith" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Email</label>
                <input value={form.email} onChange={e => update('email', e.target.value)}
                  className={inputClasses} placeholder="john@company.com" type="email" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Phone</label>
                <input value={form.phone} onChange={e => update('phone', e.target.value)}
                  className={inputClasses} placeholder="(555) 123-4567" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Company</label>
                <input value={form.company} onChange={e => update('company', e.target.value)}
                  className={inputClasses} placeholder="ABC Realty" />
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Property Details */}
        {step === 1 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-6 text-black dark:text-zinc-50">Property Details</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Property Address</label>
                <input value={form.propertyAddress} onChange={e => update('propertyAddress', e.target.value)}
                  className={inputClasses} placeholder="123 Main St, City, State" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Property Name</label>
                <input value={form.propertyName} onChange={e => update('propertyName', e.target.value)}
                  className={inputClasses} placeholder="Main Street Tower" />
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Property Type</label>
                <select value={form.propertyType} onChange={e => update('propertyType', e.target.value)}
                  className={inputClasses}>
                  <option>Office</option>
                  <option>Retail</option>
                  <option>Industrial</option>
                  <option>Flex</option>
                  <option>Mixed Use</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Images */}
        {step === 2 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-6 text-black dark:text-zinc-50">Property Images</h2>
            <p className="text-gray-600 dark:text-zinc-400 mb-4">Upload photos of your property. Our AI will enhance them for marketplace listings.</p>
            <label className="block border-2 border-dashed border-gray-300 dark:border-zinc-600 p-12 text-center cursor-pointer hover:border-black dark:hover:border-zinc-400 transition">
              <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
              <div className="text-4xl mb-2">+</div>
              <div className="font-bold text-black dark:text-zinc-50">Click to upload images</div>
              <div className="text-sm text-gray-500 dark:text-zinc-500 mt-1">JPG, PNG up to 10MB each</div>
            </label>
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-4">
                {images.map((img, i) => (
                  <div key={i} className="border border-gray-200 dark:border-zinc-700 overflow-hidden aspect-video">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Integrations */}
        {step === 3 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-6 text-black dark:text-zinc-50">Integrations</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Calendar Link (Calendly, Cal.com, etc.)</label>
                <input value={form.calendarLink} onChange={e => update('calendarLink', e.target.value)}
                  className={inputClasses} placeholder="https://calendly.com/yourname" />
                <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">Leads will receive this link to book a tour.</p>
              </div>
              <div>
                <label className="text-sm font-bold text-gray-700 dark:text-zinc-300 block mb-1">Google Sheet Link</label>
                <input value={form.sheetLink} onChange={e => update('sheetLink', e.target.value)}
                  className={inputClasses} placeholder="https://docs.google.com/spreadsheets/d/..." />
                <p className="text-xs text-gray-500 dark:text-zinc-500 mt-1">All lead info will be logged here automatically.</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Review */}
        {step === 4 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-6 text-black dark:text-zinc-50">Review & Confirm</h2>
            <div className="space-y-4">
              <div className="border border-gray-200 dark:border-zinc-700 p-4">
                <div className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-2">Personal Info</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Name:</strong> {form.name}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Email:</strong> {form.email}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Phone:</strong> {form.phone}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Company:</strong> {form.company}</div>
              </div>
              <div className="border border-gray-200 dark:border-zinc-700 p-4">
                <div className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-2">Property</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Address:</strong> {form.propertyAddress}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Name:</strong> {form.propertyName}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Type:</strong> {form.propertyType}</div>
              </div>
              <div className="border border-gray-200 dark:border-zinc-700 p-4">
                <div className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-2">Images</div>
                <div className="text-sm text-black dark:text-zinc-200">{images.length} image(s) uploaded</div>
              </div>
              <div className="border border-gray-200 dark:border-zinc-700 p-4">
                <div className="text-xs font-bold text-gray-500 dark:text-zinc-400 uppercase mb-2">Integrations</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Calendar:</strong> {form.calendarLink || 'Not set'}</div>
                <div className="text-sm text-black dark:text-zinc-200"><strong>Google Sheet:</strong> {form.sheetLink || 'Not set'}</div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-8">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className={`px-6 py-3 border-2 border-black dark:border-zinc-600 font-bold text-black dark:text-zinc-50 transition ${
              step === 0 ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-50 dark:hover:bg-zinc-800'
            }`}
          >
            Back
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              className="px-6 py-3 bg-black dark:bg-white text-white dark:text-black font-bold hover:bg-gray-900 dark:hover:bg-zinc-200 transition"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              className="px-6 py-3 bg-black dark:bg-white text-white dark:text-black font-bold hover:bg-gray-900 dark:hover:bg-zinc-200 transition"
            >
              Submit & Start Leasing
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
