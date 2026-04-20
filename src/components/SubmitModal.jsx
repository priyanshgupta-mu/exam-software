import styles from './SubmitModal.module.css'

export default function SubmitModal({ answeredCount, totalCount, onConfirm, onCancel }) {
  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2>Submit Exam?</h2>
        <p>
          You have answered <strong>{answeredCount}</strong> of <strong>{totalCount}</strong> questions.
          Are you sure you want to submit?
        </p>
        <div className={styles.actions}>
          <button className={styles.btnCancel}  onClick={onCancel}>Cancel</button>
          <button className={styles.btnConfirm} onClick={onConfirm}>Yes, Submit</button>
        </div>
      </div>
    </div>
  )
}
