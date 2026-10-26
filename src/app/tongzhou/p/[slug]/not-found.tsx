import styles from "@/features/tongzhou/public-profile.module.css";
export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={`${styles.sheet} ${styles.unavailable}`}>
        <p className={styles.brand}>同舟婚恋</p>
        <h1>页面暂不可访问</h1>
        <p>该链接暂不可用，请向分享者确认。</p>
      </div>
    </main>
  );
}
