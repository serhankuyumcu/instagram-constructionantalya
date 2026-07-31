/** Bir blog yazisinin tek bir "## " bolumu. Gonderi uretiminin atomik birimi budur. */
export interface ArticleSection {
  /** Yazi icindeki sirasi (0 = giris bolumu, baslik yoksa). */
  readonly index: number;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** Bolumun duz metni; caption uretimine bu beslenir. */
  readonly text: string;
}

/** Yazinin kendi sayfasindan alinan gorsel. */
export interface ArticleImage {
  readonly url: string;
  /** Sayfadaki ilk/kapak gorseli mi? Giris bolumune bu verilir. */
  readonly isHero: boolean;
}

export interface Article {
  readonly slug: string;
  readonly url: string;
  readonly title: string;
  readonly description: string;
  /**
   * Yazi sayfasinda gecen gorseller, sayfadaki siralariyla.
   * Gonderi karesi bunlardan uretilir; yazinin kendi secimi oldugu icin
   * icerikle editoryal olarak ortusur.
   */
  readonly images: readonly ArticleImage[];
  readonly sections: readonly ArticleSection[];
}

/**
 * Tek bir Instagram gonderisine karsilik gelen icerik birimi.
 * Bir yazidan onlarca birim cikar; havuz bu sayede aylarca yeter.
 */
export interface PostUnit {
  /** Kalici benzersiz kimlik: "slug#3". Durum dosyasinda bu saklanir. */
  readonly id: string;
  readonly articleSlug: string;
  readonly articleTitle: string;
  readonly articleUrl: string;
  readonly heading: string;
  readonly text: string;
  /** Hashtag secimi icin cikarilan anahtar kelimeler. */
  readonly keywords: readonly string[];
  /** Yazinin kendi gorselleri; gonderi karesi yalnizca bunlardan secilir. */
  readonly images: readonly ArticleImage[];
  /** Bolumun yazi icindeki sirasi; gorsel dagitimi buna gore yapilir. */
  readonly sectionIndex: number;
}
