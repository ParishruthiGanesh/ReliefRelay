'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, FieldLabel } from './ui';
import type { PickerFacility } from './LeafletPicker';

/**
 * Three honest ways to say where you are.
 *
 *   1. your device's own location, with its stated accuracy shown;
 *   2. a pin you place on the map yourself;
 *   3. a known shelter or hub from the list.
 *
 * All three end in a point the person has confirmed. Nothing here converts
 * typed words into coordinates — that is the whole reason this component
 * exists. Exact points are stored for coordinators only; the public map shows
 * a coarsened version.
 */

const Picker = dynamic(() => import('./LeafletPicker').then((m) => m.LeafletPicker), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-xl bg-sand-200 text-sm text-ink-500">
      Loading map…
    </div>
  ),
});

export interface ChosenLocation {
  facilityId?: string;
  lat: number;
  lng: number;
  label: string;
}

type GeoState = 'idle' | 'asking' | 'ok' | 'denied' | 'unavailable';

export function LocationPicker({
  center,
  onConfirm,
  busy = false,
  confirmLabel = 'Use this location',
}: {
  center: { lat: number; lng: number };
  onConfirm: (location: ChosenLocation) => void;
  busy?: boolean;
  confirmLabel?: string;
}) {
  const [facilities, setFacilities] = useState<PickerFacility[]>([]);
  const [chosen, setChosen] = useState<{ lat: number; lng: number } | null>(null);
  const [chosenFacility, setChosenFacility] = useState<PickerFacility | null>(null);
  const [describe, setDescribe] = useState('');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [geo, setGeo] = useState<GeoState>('idle');
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/facilities')
      .then((r) => r.json())
      .then((body) => setFacilities(body.facilities ?? []))
      .catch(() => setFacilities([]));
  }, []);

  const useMyLocation = () => {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeo('unavailable');
      setGeoError('This browser cannot provide your location. Place a pin on the map instead.');
      return;
    }
    setGeo('asking');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setChosen({ lat: position.coords.latitude, lng: position.coords.longitude });
        setAccuracy(position.coords.accuracy ?? null);
        setChosenFacility(null);
        setGeo('ok');
      },
      (error) => {
        setGeo(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? 'Your browser did not allow location access. You can still place a pin on the map, or choose a known place below.'
            : `Your location could not be read (${error.message}). Place a pin on the map instead.`,
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const pick = (lat: number, lng: number) => {
    setChosen({ lat, lng });
    setAccuracy(null);
    const match = facilities.find(
      (f) => Math.abs(f.lat - lat) < 0.0002 && Math.abs(f.lng - lng) < 0.0002,
    );
    setChosenFacility(match ?? null);
  };

  const label =
    chosenFacility?.name ||
    describe.trim() ||
    (chosen ? `Point chosen on the map (${chosen.lat.toFixed(4)}, ${chosen.lng.toFixed(4)})` : '');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={geo === 'asking' || busy} onClick={useMyLocation} variant="secondary">
          {geo === 'asking' ? 'Asking your browser…' : '📍 Use my current location'}
        </Button>
        <span className="text-sm text-ink-500">or tap the map to place a pin</span>
      </div>

      {geoError ? <Alert tone="attention">{geoError}</Alert> : null}

      {geo === 'ok' && accuracy ? (
        <p className="text-sm text-ink-700">
          <Badge tone="good">Location found</Badge> Your device reports it is accurate to about{' '}
          {Math.round(accuracy)} metres — the dashed circle. Drag the map and tap to correct it if
          that is not where you are.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-sand-200" style={{ height: 320 }}>
        <Picker
          accuracyMetres={accuracy}
          center={center}
          chosen={chosen}
          facilities={facilities}
          onPick={pick}
        />
      </div>

      <p className="text-xs text-ink-500">
        Fictional demonstration places drawn on a real map. Your exact point is shown to
        coordinators only; the public map shows an area of about a kilometre, never your doorstep.
      </p>

      <div>
        <FieldLabel htmlFor="known-place" hint="If you are at one of these, choosing it is the most precise option.">
          Or choose a known place
        </FieldLabel>
        <select
          className="rr-input mt-1"
          id="known-place"
          onChange={(event) => {
            const facility = facilities.find((f) => f.id === event.target.value);
            if (!facility) {
              setChosenFacility(null);
              return;
            }
            setChosenFacility(facility);
            setChosen({ lat: facility.lat, lng: facility.lng });
            setAccuracy(null);
          }}
          value={chosenFacility?.id ?? ''}
        >
          <option value="">Not one of these</option>
          {facilities.map((facility) => (
            <option key={facility.id} value={facility.id}>
              {facility.name} ({facility.kind === 'shelter' ? 'shelter' : 'supply hub'})
            </option>
          ))}
        </select>
      </div>

      {chosen && !chosenFacility ? (
        <div>
          <FieldLabel htmlFor="describe-place" hint="Helps a coordinator find you. Optional.">
            What is this place called?
          </FieldLabel>
          <input
            className="rr-input mt-1"
            id="describe-place"
            onChange={(event) => setDescribe(event.target.value)}
            placeholder="For example: the school hall on Mill Lane"
            value={describe}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={!chosen || busy}
          onClick={() =>
            chosen &&
            onConfirm({
              facilityId: chosenFacility?.id,
              lat: chosen.lat,
              lng: chosen.lng,
              label,
            })
          }
          size="lg"
        >
          {busy ? 'Saving…' : confirmLabel}
        </Button>
        {chosen ? (
          <span className="text-sm text-ink-700">{label}</span>
        ) : (
          <span className="text-sm text-ink-500">Nothing chosen yet.</span>
        )}
      </div>
    </div>
  );
}
