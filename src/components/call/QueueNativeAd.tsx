import React, { useEffect, useRef, useState } from "react";
import { View, Text } from "react-native";
import AppText from "../AppText";
import { useTranslation } from "../../i18n/LanguageProvider";
import { NativeAd, NativeAdView, NativeAsset, NativeAssetType, NativeMediaView, NativeMediaAspectRatio } from "react-native-google-mobile-ads";

type QueueNativeAdProps = {
  styles: any;
  width: number;
};

const NATIVE_UNIT_ID = (process.env.EXPO_PUBLIC_AD_UNIT_NATIVE_ANDROID ?? "").trim() || "ca-app-pub-5144004139813427/8416045900";

export default function QueueNativeAd256x144({ styles, width }: QueueNativeAdProps) {
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);
  const adRef = useRef<NativeAd | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;

    NativeAd.createForAdRequest(NATIVE_UNIT_ID, { aspectRatio: NativeMediaAspectRatio.LANDSCAPE })
      .then((ad) => {
        if (!alive) {
          try {
            ad.destroy();
          } catch {}
          return;
        }
        adRef.current = ad;
        setNativeAd(ad);
      })
      .catch(() => {});

    return () => {
      alive = false;
      try {
        adRef.current?.destroy();
      } catch {}
      adRef.current = null;
    };
  }, []);

  if (!nativeAd) return null;

  return (
    <NativeAdView nativeAd={nativeAd} style={[styles.nativeAd256, { width, height: Math.round((width * 202) / 360) }]}>
      <View style={styles.nativeAdInner}>
        <NativeMediaView style={styles.nativeAdMedia} resizeMode="cover" />
        <View style={styles.nativeAdFooter}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.nativeAdHeadline} numberOfLines={1}>
              {nativeAd.headline}
            </Text>
          </NativeAsset>
          <AppText style={styles.nativeAdTag}>{t("common.ad")}</AppText>
        </View>
      </View>
    </NativeAdView>
  );
}
