import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Pressable, Text, ActivityIndicator, Alert } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from 'react-native-maps';

export interface MapPoint {
  latitude: number;
  longitude: number;
}

interface WorkoutMapProps {
  gpsPath: MapPoint[];
  pointA: MapPoint | null;
  currentLocation: MapPoint | null;
  mapType?: 'standard' | 'satellite';
  onMapTypeToggle?: () => void;
}

interface POIItem {
  id: number;
  latitude: number;
  longitude: number;
  name: string;
  type: 'cafe' | 'restaurant' | 'shop';
}

export default function WorkoutMap({
  gpsPath,
  pointA,
  currentLocation,
  mapType = 'standard',
  onMapTypeToggle,
}: WorkoutMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const [poiType, setPoiType] = useState<'none' | 'cafe' | 'restaurant' | 'shop'>('none');
  const [pois, setPois] = useState<POIItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-center map camera when current location changes (only if no POI search is active)
  useEffect(() => {
    if (currentLocation && mapRef.current && poiType === 'none') {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          latitudeDelta: 0.002, // Close zoom level (approx 200m scale)
          longitudeDelta: 0.002,
        },
        1000 // duration of camera shift animation (ms)
      );
    }
  }, [currentLocation, poiType]);

  const fetchNearbyPOIs = async (type: 'cafe' | 'restaurant' | 'shop') => {
    if (loading) return;
    const loc = currentLocation || pointA || (gpsPath.length > 0 ? gpsPath[gpsPath.length - 1] : null);
    if (!loc) return;

    setLoading(true);
    setPoiType(type);

    try {
      let amenityQuery = '';
      if (type === 'cafe') {
        amenityQuery = '[amenity=cafe]';
      } else if (type === 'restaurant') {
        amenityQuery = '[amenity~"restaurant|fast_food|food_court"]';
      } else if (type === 'shop') {
        amenityQuery = '[shop~"convenience|supermarket|mall|department_store"]';
      }

      // Query Overpass API for elements within 800m
      const query = `[out:json][timeout:10];
        (
          node(around:800,${loc.latitude},${loc.longitude})${amenityQuery};
        );
        out body 15;`;

      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
      const res = await fetch(url);
      const data = await res.json();

      if (data && data.elements && data.elements.length > 0) {
        const items = data.elements
          .filter((el: any) => el.lat && el.lon)
          .map((el: any) => ({
            id: el.id,
            latitude: el.lat,
            longitude: el.lon,
            name: el.tags?.name || (type === 'cafe' ? 'Coffee Shop' : type === 'restaurant' ? 'Restaurant' : 'Store'),
            type,
          }));
        setPois(items);

        // Zoom out map dynamically to fit starting location, user location, and all POI pins
        if (items.length > 0 && mapRef.current) {
          const coordinatesToFit = [
            ...(loc ? [loc] : []),
            ...(pointA ? [pointA] : []),
            ...items.map((item: any) => ({
              latitude: item.latitude,
              longitude: item.longitude,
            })),
          ];

          setTimeout(() => {
            if (mapRef.current) {
              mapRef.current.fitToCoordinates(coordinatesToFit, {
                edgePadding: { top: 60, right: 60, bottom: 80, left: 60 },
                animated: true,
              });
            }
          }, 300);
        }
      } else {
        setPois([]);
        Alert.alert('No Results', `No nearby ${type === 'cafe' ? 'coffee shops' : type === 'restaurant' ? 'restaurants' : 'stores'} found within 800m.`);
      }
    } catch (e) {
      console.warn('Failed to fetch nearby POIs:', e);
      setPois([]);
      Alert.alert('Search Error', 'Unable to retrieve nearby locations. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClearPOIs = () => {
    setPoiType('none');
    setPois([]);
  };

  // Fallback map view coordinates if no location has been locked yet
  const initialRegion = pointA
    ? {
        latitude: pointA.latitude,
        longitude: pointA.longitude,
        latitudeDelta: 0.003,
        longitudeDelta: 0.003,
      }
    : {
        latitude: 37.7749, // Default to San Francisco center if empty
        longitude: -122.4194,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={false} // Custom user pin is used instead for styling
        showsCompass={true}
        showsMyLocationButton={false}
        mapType={mapType}
      >
        {/* Render walking trail path */}
        {gpsPath.length > 1 && (
          <Polyline
            coordinates={gpsPath}
            strokeColor="#8b5cf6" // Premium Purple color
            strokeWidth={4}
            geodesic={true}
          />
        )}

        {/* Start Point Marker (Point A) */}
        {pointA && (
          <Marker
            coordinate={pointA}
            title="Start Point"
            description="Your calibrated start line location"
            pinColor="#10b981" // Emerald Green
          />
        )}

        {/* Live User Position Marker */}
        {currentLocation && (
          <Marker
            coordinate={currentLocation}
            title="You"
            description="Current position"
            pinColor="#06b6d4" // Cyan Blue
          />
        )}

        {/* Nearby POI Markers */}
        {pois.map((poi) => (
          <Marker
            key={poi.id.toString()}
            coordinate={{ latitude: poi.latitude, longitude: poi.longitude }}
            title={poi.name}
            description={poi.type === 'cafe' ? '☕ Coffee Shop' : poi.type === 'restaurant' ? '🍔 Restaurant' : '🛒 Convenience Store'}
            pinColor={poi.type === 'cafe' ? '#eab308' : poi.type === 'restaurant' ? '#ef4444' : '#3b82f6'}
          />
        ))}
      </MapView>

      {/* Floating Map Type Selector Toggle */}
      {onMapTypeToggle && (
        <Pressable
          onPress={onMapTypeToggle}
          style={styles.floatingMapToggle}
        >
          <Text style={styles.mapToggleText}>{mapType === 'satellite' ? '🗺️ Std' : '🛰️ Sat'}</Text>
        </Pressable>
      )}

      {/* Loading Indicator */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#ffffff" />
        </View>
      )}

      {/* Floating Nearby Amenities Bar */}
      {(currentLocation || pointA || gpsPath.length > 0) && (
        <View style={styles.poiBar}>
          <Pressable
            onPress={() => fetchNearbyPOIs('cafe')}
            style={[styles.poiBtn, poiType === 'cafe' && styles.poiBtnActive]}
          >
            <Text style={styles.poiText}>☕ Coffee</Text>
          </Pressable>
          <Pressable
            onPress={() => fetchNearbyPOIs('restaurant')}
            style={[styles.poiBtn, poiType === 'restaurant' && styles.poiBtnActive]}
          >
            <Text style={styles.poiText}>🍔 Food</Text>
          </Pressable>
          <Pressable
            onPress={() => fetchNearbyPOIs('shop')}
            style={[styles.poiBtn, poiType === 'shop' && styles.poiBtnActive]}
          >
            <Text style={styles.poiText}>🛒 Store</Text>
          </Pressable>
          {poiType !== 'none' && (
            <Pressable
              onPress={handleClearPOIs}
              style={[styles.poiBtn, styles.poiClearBtn]}
            >
              <Text style={[styles.poiText, { color: '#ffffff' }]}>✕</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 280,
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#334155',
    marginVertical: 12,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  floatingMapToggle: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.85)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  mapToggleText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.85)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  poiBar: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(31, 41, 55, 0.85)',
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: '#374151',
  },
  poiBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  poiBtnActive: {
    backgroundColor: '#8b5cf6',
  },
  poiClearBtn: {
    flex: 0.5,
    backgroundColor: '#ef4444',
  },
  poiText: {
    color: '#e5e7eb',
    fontSize: 11,
    fontWeight: '600',
  },
});
