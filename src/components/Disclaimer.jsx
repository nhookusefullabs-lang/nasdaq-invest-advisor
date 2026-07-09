export default function Disclaimer({ generatedAt }) {
  return (
    <div className="mt-8 border-t border-gray-200 pt-4 text-xs text-gray-500 space-y-1">
      <p>데이터 기준일: {generatedAt ?? '-'}</p>
      <p>투자 참고용이며 투자 손실 책임은 본인에게 있습니다.</p>
    </div>
  )
}
