(function () {
  'use strict';

  const reportRoomCode = document.getElementById('reportRoomCode');
  const reportReason = document.getElementById('reportReason');
  const reportDetails = document.getElementById('reportDetails');
  const submitReportBtn = document.getElementById('submitReportBtn');
  const reportFeedback = document.getElementById('reportFeedback');

  // Pre-fill room code from query ?room= if present
  const params = new URLSearchParams(window.location.search);
  if (params.get('room') && reportRoomCode) {
    reportRoomCode.value = params.get('room').toUpperCase();
  }

  // Pre-fill email link with REPORT_EMAIL if available
  fetch('/api/config')
    .then(r => r.json())
    .then(data => {
      const emailLink = document.getElementById('emailAbuseLink');
      if (emailLink && data.reportEmail) {
        emailLink.href = `mailto:${encodeURIComponent(data.reportEmail)}`;
        emailLink.textContent = `Direct Email: ${data.reportEmail}`;
      }
    })
    .catch(() => {});

  if (submitReportBtn) {
    submitReportBtn.addEventListener('click', async () => {
      submitReportBtn.disabled = true;
      submitReportBtn.innerHTML = '<span class="btn-spinner"></span> Submitting...';
      reportFeedback.textContent = '';

      try {
        const res = await fetch('/api/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomCode: reportRoomCode.value.trim().toUpperCase(),
            reason: reportReason.value,
            details: reportDetails.value.trim()
          })
        });

        const data = await res.json();
        submitReportBtn.disabled = false;
        submitReportBtn.textContent = 'Submit Abuse Report';

        if (res.ok) {
          reportFeedback.style.color = 'var(--success)';
          reportFeedback.textContent = 'Thank you. Your report has been submitted for immediate automated review.';
          reportRoomCode.value = '';
          reportDetails.value = '';
        } else {
          reportFeedback.style.color = 'var(--danger)';
          reportFeedback.textContent = data.error || 'Failed to submit report.';
        }
      } catch (err) {
        submitReportBtn.disabled = false;
        submitReportBtn.textContent = 'Submit Abuse Report';
        reportFeedback.style.color = 'var(--danger)';
        reportFeedback.textContent = 'Network error submitting report.';
      }
    });
  }
})();
